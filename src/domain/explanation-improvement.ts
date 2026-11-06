import type { CapabilityFailure } from '../capabilities/types.ts';
import type { ExplanationImprovementRequest } from '../language-assistance/types.ts';
import type { DecisionReason, FindingCode, InvestigationDecision, LedgerFact } from './finding-policy.ts';
import { FINDING_SOURCE_PACK_VERSION, findingSourcePack, type SourceReference } from './finding-source-pack.ts';
import type { ConfirmedFulfillmentIntake } from './fulfillment-playbook.ts';

/**
 * An improved explanation, with the same pinned Source Pack version as the
 * deterministic one. `generatedAt` comes from the caller's clock.
 */
export interface ImprovedExplanation {
  readonly summary: string;
  readonly sourcePackVersion: typeof FINDING_SOURCE_PACK_VERSION;
  readonly sources: readonly SourceReference[];
  readonly generatedAt: string;
}

function placeholderPattern(): RegExp {
  return /\{\{([a-zA-Z0-9_]+)\}\}/g;
}

/**
 * Placeholder name to value, from confirmed intake plus identifiers the
 * ledger or a capability failure produced. Only the names go to the model.
 */
export function buildAllowedPlaceholders(input: {
  readonly intake: ConfirmedFulfillmentIntake;
  readonly ledgerFacts: readonly LedgerFact[];
  readonly capabilityFailure?: CapabilityFailure;
}): Readonly<Record<string, string>> {
  const placeholders: Record<string, string> = {
    skuId: input.intake.skuId,
    seller: input.intake.seller,
    quantity: String(input.intake.quantity),
    destinationPostalCode: input.intake.destinationPostalCode,
  };

  for (const fact of input.ledgerFacts) {
    if (fact.kind === 'warehouse-to-dock') {
      placeholders.warehouseId = fact.warehouseId;
      placeholders.dockId = fact.dockId;
    }
    if (fact.kind === 'dock-to-policy') {
      placeholders.dockId = fact.dockId;
      placeholders.policyId = fact.policyId;
    }
    if (fact.kind === 'destination-coverage') {
      placeholders.policyId = fact.policyId;
    }
  }

  if (input.capabilityFailure) {
    placeholders.capabilityName = input.capabilityFailure.capability;
    placeholders.capabilityFailureMessage = input.capabilityFailure.message;
  }

  return placeholders;
}

/**
 * The deterministic capability-failure summary embeds the provider's error
 * message, which the model must not see. This rebuilds that one summary with
 * placeholders; every other summary is reused as-is.
 */
function deterministicSummaryForModel(input: {
  readonly deterministicSummary: string;
  readonly capabilityFailure?: CapabilityFailure;
}): string {
  if (!input.capabilityFailure) {
    return input.deterministicSummary;
  }
  return (
    'The {{capabilityName}} check could not be completed ({{capabilityFailureMessage}}). No Finding could be ' +
    'established from partial evidence; this case requires specialist review.'
  );
}

/**
 * The model sees the Finding, Decision, Decision Reason, the deterministic
 * explanation and placeholder names, never their values or raw facts.
 */
export function buildExplanationImprovementRequest(input: {
  readonly findingCode: FindingCode;
  readonly decision: InvestigationDecision;
  readonly decisionReason: DecisionReason;
  readonly deterministicSummary: string;
  readonly placeholders: Readonly<Record<string, string>>;
  readonly capabilityFailure?: CapabilityFailure;
}): ExplanationImprovementRequest {
  return {
    findingCode: input.findingCode,
    decision: input.decision,
    decisionReason: input.decisionReason,
    deterministicSummary: deterministicSummaryForModel(input),
    allowedPlaceholderNames: Object.keys(input.placeholders),
    sourcePackUrls: findingSourcePack(input.findingCode).map((source) => source.url),
  };
}

export type GroundingCheck =
  | { readonly kind: 'grounded'; readonly explanation: ImprovedExplanation }
  | { readonly kind: 'ungrounded'; readonly reason: string };

/**
 * The grounding gate (ADR-0045): every `{{placeholder}}` must be allowlisted,
 * no digit may appear outside a placeholder, and every citation must be in
 * the Finding's Source Pack. It is structural, not semantic: it proves no new
 * fact was introduced, not that the wording is true. Placeholders are
 * substituted only after every check passes.
 */
export function checkExplanationGrounding(
  proposal: { readonly summaryTemplate: string; readonly citedSourceUrls: readonly string[] },
  allowed: { readonly findingCode: FindingCode; readonly placeholders: Readonly<Record<string, string>> },
  generatedAt: string,
): GroundingCheck {
  if (proposal.citedSourceUrls.length === 0) {
    return { kind: 'ungrounded', reason: 'The improved explanation cited no Finding Source Pack reference.' };
  }

  const pinnedPack = findingSourcePack(allowed.findingCode);
  const pinnedUrls = new Set(pinnedPack.map((source) => source.url));
  const uncitable = proposal.citedSourceUrls.filter((url) => !pinnedUrls.has(url));
  if (uncitable.length > 0) {
    return {
      kind: 'ungrounded',
      reason: `Cited source(s) not in the pinned Finding Source Pack: ${uncitable.join(', ')}`,
    };
  }

  const usedPlaceholders = new Set<string>();
  for (const match of proposal.summaryTemplate.matchAll(placeholderPattern())) {
    usedPlaceholders.add(match[1] as string);
  }
  const unknownPlaceholders = [...usedPlaceholders].filter((name) => !(name in allowed.placeholders));
  if (unknownPlaceholders.length > 0) {
    return {
      kind: 'ungrounded',
      reason: `Referenced placeholder(s) outside the allowed facts: ${unknownPlaceholders
        .map((name) => `{{${name}}}`)
        .join(', ')}`,
    };
  }

  const withoutPlaceholders = proposal.summaryTemplate.replace(placeholderPattern(), '');
  if (/\d/.test(withoutPlaceholders)) {
    return {
      kind: 'ungrounded',
      reason: 'The improved explanation contains a number or identifier outside an allowed placeholder.',
    };
  }

  const summary = proposal.summaryTemplate.replace(
    placeholderPattern(),
    (_match, name: string) => allowed.placeholders[name] ?? '',
  );
  const sources = pinnedPack.filter((source) => proposal.citedSourceUrls.includes(source.url));

  return {
    kind: 'grounded',
    explanation: { summary, sourcePackVersion: FINDING_SOURCE_PACK_VERSION, sources, generatedAt },
  };
}
