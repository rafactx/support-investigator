import type { CapabilityFailure } from '../capabilities/types.ts';
import type { ExplanationImprovementRequest } from '../language-assistance/types.ts';
import type { DecisionReason, FindingCode, InvestigationDecision, LedgerFact } from './finding-policy.ts';
import { FINDING_SOURCE_PACK_VERSION, findingSourcePack, type SourceReference } from './finding-source-pack.ts';
import type { ConfirmedFulfillmentIntake } from './fulfillment-playbook.ts';

/**
 * The Bedrock-improved explanation: same pinned Source Pack
 * version and provenance concept as the deterministic `FindingExplanation`
 * (`finding-source-pack.ts`), plus `generatedAt` from the caller's own
 * clock — never `new Date()` inside this module, so tests stay
 * deterministic the same way `now()` is threaded everywhere else in this
 * codebase.
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
 * The placeholder allowlist: `ConfirmedFulfillmentIntake` (never an
 * unconfirmed model proposal — the same narrowing seam ADR-0044 already
 * establishes for the Fulfillment Playbook) plus whatever identifiers the
 * Evidence Ledger or a capability failure actually produced for this
 * Investigation. Keyed by placeholder name: `buildExplanationImprovementRequest`
 * sends only these *names* to the model, never the values held here, so a
 * fabricated identifier is a placeholder that fails to resolve rather than
 * a string pattern matched out of free prose after the fact.
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
 * `finding-source-pack.ts`'s deterministic `summaryFor` interpolates
 * `capabilityFailure.capability`/`.message` verbatim into prose for every
 * *other* Decision Reason's already-generic, digit-free text — but a
 * capability failure message is a provider/transport string this project
 * never controls, so it is exactly the kind of raw identifier the model
 * must never see directly (it could contain a digit, defeating
 * `checkExplanationGrounding`'s own "no raw digit outside a placeholder"
 * check with a false rejection, and it's the one channel that would
 * otherwise show the model a real value instead of a placeholder name).
 * This rebuilds only that one branch's model-facing text using the same
 * `{{capabilityName}}`/`{{capabilityFailureMessage}}` placeholders
 * `buildAllowedPlaceholders` already reserves for it — every other
 * Decision Reason's deterministic text is reused as-is.
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
 * Builds the bounded `LanguageAssistance.improveExplanation` request
 * from exactly the confirmed, completed-Investigation
 * facts the model may see: Finding, Decision, Decision Reason, the
 * deterministic explanation to improve on, and the allowed placeholder
 * *names* — never their values, and never a raw Ledger Fact or intake
 * field directly. `placeholders` is the caller's own
 * `buildAllowedPlaceholders` result, passed in rather than recomputed here,
 * so a route that also needs the full name-to-value map for
 * `checkExplanationGrounding` (every caller does) computes it once.
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
 * The deterministic grounding gate: every
 * `{{placeholder}}` in the model's `summaryTemplate` must be one this
 * Investigation actually allowlisted, no digit may appear outside a
 * placeholder (a raw number is either a fabricated identifier or one the
 * model retyped instead of citing symbolically — both are rejected the
 * same way), and every cited URL must already be in the pinned Finding
 * Source Pack for this Finding Code. This is a structural check, not a
 * semantic one: it cannot verify that a claim built entirely from
 * allowlisted placeholders and plain wording is *true*, only that it
 * introduces no fact this Investigation never produced. Passing
 * placeholders are substituted with their real value only after every
 * check succeeds — the model itself never received a real identifier to
 * begin with (`buildExplanationImprovementRequest` sends only placeholder
 * names).
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
