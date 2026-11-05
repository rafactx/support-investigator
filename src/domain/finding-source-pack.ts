import type { CapabilityFailure } from '../capabilities/types.ts';
import type { DecisionReason, FindingCode } from './finding-policy.ts';

/**
 * CONTEXT.md's Finding Source Pack: the versioned set of support runbooks
 * selected for one supported Finding Code. It grounds explanations and
 * recommended human actions, but it is not case evidence and cannot
 * satisfy an Evidence Contract. The references are runbooks committed under
 * `src/kb/articles/` (`finding-source-pack.test.ts` proves each one exists
 * with a matching title). Pinned by hand, not fetched —
 * ADR-0009's amendment: this is not the Knowledge Index, and a retrieval
 * result can never become or replace it.
 */
export const FINDING_SOURCE_PACK_VERSION = '1';

export interface SourceReference {
  readonly title: string;
  readonly url: string;
}

export interface FindingExplanation {
  readonly summary: string;
  readonly sourcePackVersion: typeof FINDING_SOURCE_PACK_VERSION;
  readonly sources: readonly SourceReference[];
}

const DESTINATION_COVERAGE_SOURCES: readonly SourceReference[] = [
  {
    title: 'Product in stock but no delivery options at checkout',
    url: 'https://docs.example.com/runbooks/stock-without-delivery-options',
  },
  {
    title: 'Destination postal code not covered by the shipping policy',
    url: 'https://docs.example.com/runbooks/destination-not-covered',
  },
];

const FINDING_SOURCE_PACKS: Record<FindingCode, readonly SourceReference[]> = {
  DESTINATION_NOT_COVERED: DESTINATION_COVERAGE_SOURCES,
  // ROOT_CAUSE_UNDETERMINED still grounds recommended next action (checking
  // logistics coverage) in the same runbooks, even though no
  // Finding Code was established.
  ROOT_CAUSE_UNDETERMINED: DESTINATION_COVERAGE_SOURCES,
};

/**
 * The pinned Source Pack for one Finding Code: the
 * only URLs an improved explanation's citations may reference. Exported
 * rather than leaving `FINDING_SOURCE_PACKS` module-private, so the
 * grounding check in `explanation-improvement.ts` validates citations
 * against this same pinned set instead of a second, hand-copied list.
 */
export function findingSourcePack(findingCode: FindingCode): readonly SourceReference[] {
  return FINDING_SOURCE_PACKS[findingCode];
}

function summaryFor(
  decisionReason: DecisionReason,
  capabilityFailure: CapabilityFailure | undefined,
): string {
  switch (decisionReason) {
    case 'contract_satisfied':
      return (
        'Inventory was available, the fulfillment simulation reproduced zero deliverable SLAs, and the ' +
        'warehouse-to-dock-to-shipping-policy route was valid, but no freight value on that policy covers ' +
        'the requested destination postal code. Recommended action: extend the shipping policy’s freight ' +
        'coverage to include this destination, or route the order through a policy that already covers it.'
      );
    case 'required_input_missing':
      return 'Required investigation intake is missing or unconfirmed. Complete or confirm the intake before this investigation can run.';
    case 'capability_failed':
      return capabilityFailure
        ? `The ${capabilityFailure.capability} check could not be completed (${capabilityFailure.message}). ` +
            'No Finding could be established from partial evidence; this case requires specialist review.'
        : 'A required operational check could not be completed. No Finding could be established from partial evidence; this case requires specialist review.';
    case 'evidence_insufficient':
      return 'Not enough of the required investigation evidence was gathered to establish or rule out a supported Finding; this case requires specialist review.';
    case 'evidence_contradictory':
      return 'The gathered evidence contradicts the supported Finding — the symptom was not reproduced, or an upstream route failed; this case requires specialist review.';
    case 'unsupported_case':
      return 'This case falls outside the currently supported Finding taxonomy; this case requires specialist review.';
  }
}

/**
 * Builds the deterministic Finding Source Pack explanation persisted with
 * every completed Investigation (ADR-0036) — template-based, not a model
 * call, so it never depends on Bedrock availability (ADR-0039). A
 * separately budgeted Bedrock-improved explanation is
 * `explanation-improvement.ts`'s job, not this function's.
 */
export function buildFindingExplanation(input: {
  readonly findingCode: FindingCode;
  readonly decisionReason: DecisionReason;
  readonly capabilityFailure?: CapabilityFailure;
}): FindingExplanation {
  return {
    summary: summaryFor(input.decisionReason, input.capabilityFailure),
    sourcePackVersion: FINDING_SOURCE_PACK_VERSION,
    sources: FINDING_SOURCE_PACKS[input.findingCode],
  };
}
