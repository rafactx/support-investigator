import type { CapabilityFailure } from '../capabilities/types.ts';
import {
  evaluateFindingPolicy,
  FINDING_POLICY_VERSION,
  type DecisionReason,
  type EvidenceContractResult,
  type FindingCode,
  type InvestigationDecision,
  type LedgerFact,
} from './finding-policy.ts';
import { buildFindingExplanation, type FindingExplanation } from './finding-source-pack.ts';
import type { ImprovedExplanation } from './explanation-improvement.ts';
import type { ConfirmedFulfillmentIntake, FulfillmentPlaybookResult } from './fulfillment-playbook.ts';

/** CONTEXT.md's Investigation Intake: "every field records whether it was supplied by the user or proposed by Language Assistance." */
export type IntakeFieldSource = 'user' | 'model';

export interface IntakeField<T> {
  readonly value: T;
  readonly source: IntakeFieldSource;
  readonly confirmed: boolean;
}

export function userConfirmed<T>(value: T): IntakeField<T> {
  return { value, source: 'user', confirmed: true };
}

/**
 * A field Language Assistance proposed from unstructured ticket text.
 * Always `confirmed: false` — an extracted identifier never directs an
 * Operational Capability until N2 confirms it.
 */
export function modelProposed<T>(value: T): IntakeField<T> {
  return { value, source: 'model', confirmed: false };
}

/** CONTEXT.md's Symptom Code — the only one this slice supports. */
export const SUPPORTED_SYMPTOM_CODE = 'STOCK_WITHOUT_DELIVERY_OPTIONS' as const;

/**
 * Every field is optional because intake may start from ticket text, partial
 * structured input, or both.
 */
export interface FulfillmentIntake {
  readonly symptomCode: typeof SUPPORTED_SYMPTOM_CODE;
  readonly accountScope?: IntakeField<{ readonly accountId: string }>;
  readonly skuId?: IntakeField<string>;
  readonly seller?: IntakeField<string>;
  readonly quantity?: IntakeField<number>;
  readonly destinationPostalCode?: IntakeField<string>;
}

export type IntakeFieldName = 'accountScope' | 'skuId' | 'seller' | 'quantity' | 'destinationPostalCode';

const REQUIRED_INTAKE_FIELDS: readonly IntakeFieldName[] = [
  'accountScope',
  'skuId',
  'seller',
  'quantity',
  'destinationPostalCode',
];

export interface IntakeGap {
  readonly field: IntakeFieldName;
  readonly reason: 'missing' | 'unconfirmed';
}

export type IntakeReadiness =
  | { readonly kind: 'ready'; readonly confirmed: ConfirmedFulfillmentIntake }
  | { readonly kind: 'awaiting_input'; readonly gaps: readonly IntakeGap[] };

/** Narrows a field the gap check already proved present. */
function requireFieldValue<T>(field: IntakeField<T> | undefined, name: IntakeFieldName): T {
  if (!field) {
    throw new Error(`Unreachable: evaluateIntakeReadiness already verified "${name}" is present.`);
  }
  return field.value;
}

/**
 * The one place that turns a possibly incomplete intake into either the
 * confirmed shape the Fulfillment Playbook requires or a list of gaps.
 */
export function evaluateIntakeReadiness(
  investigationId: string,
  intake: FulfillmentIntake,
): IntakeReadiness {
  const gaps: IntakeGap[] = [];
  for (const field of REQUIRED_INTAKE_FIELDS) {
    const current = intake[field];
    if (!current) {
      gaps.push({ field, reason: 'missing' });
    } else if (!current.confirmed) {
      gaps.push({ field, reason: 'unconfirmed' });
    }
  }

  if (gaps.length > 0) {
    return { kind: 'awaiting_input', gaps };
  }

  return {
    kind: 'ready',
    confirmed: {
      investigationId,
      accountScope: requireFieldValue(intake.accountScope, 'accountScope'),
      skuId: requireFieldValue(intake.skuId, 'skuId'),
      seller: requireFieldValue(intake.seller, 'seller'),
      quantity: requireFieldValue(intake.quantity, 'quantity'),
      destinationPostalCode: requireFieldValue(intake.destinationPostalCode, 'destinationPostalCode'),
    },
  };
}

/** A `FulfillmentIntake` where every field is supplied and confirmed by the user. */
export function confirmedUserIntake(input: {
  readonly accountId: string;
  readonly skuId: string;
  readonly seller: string;
  readonly quantity: number;
  readonly destinationPostalCode: string;
}): FulfillmentIntake {
  return {
    symptomCode: SUPPORTED_SYMPTOM_CODE,
    accountScope: userConfirmed({ accountId: input.accountId }),
    skuId: userConfirmed(input.skuId),
    seller: userConfirmed(input.seller),
    quantity: userConfirmed(input.quantity),
    destinationPostalCode: userConfirmed(input.destinationPostalCode),
  };
}

/**
 * CONTEXT.md's Investigation State for the synchronous slice:
 * `awaiting_input` means required intake is missing, ambiguous or holds an
 * unconfirmed model proposal; `completed` means the playbook produced an
 * auditable decision (including a specialist-review decision after a
 * capability failure); `failed` is reserved for a technical failure that
 * prevented any auditable decision.
 */
export type InvestigationState = 'awaiting_input' | 'completed' | 'failed';

/**
 * `rejected` means the grounding check caught an unsupported claim or
 * citation and the deterministic explanation stands. A model failure is not
 * recorded here; the route returns 503 without committing anything.
 */
export type ExplanationImprovementOutcome =
  | { readonly status: 'accepted'; readonly improvedExplanation: ImprovedExplanation }
  | { readonly status: 'rejected'; readonly reason: string };

/** Why a review corrected a Finding or stayed inconclusive. Free text goes in `note`. */
export type ReviewReason =
  | 'missing_evidence'
  | 'blocked_access'
  | 'conflicting_evidence'
  | 'outside_supported_playbook';

/**
 * `corrected` must use a supported `FindingCode`, so a cause outside the
 * playbook can only be `inconclusive` with `outside_supported_playbook`.
 * `automatedFindingCode` is captured when the review is appended, so a later
 * playbook rerun cannot change what the review evaluated.
 */
export type HumanReview =
  | {
      readonly outcome: 'confirmed';
      readonly reviewerName: string;
      readonly automatedFindingCode: FindingCode;
      readonly occurredAt: string;
      readonly note?: string;
    }
  | {
      readonly outcome: 'corrected';
      readonly reviewerName: string;
      readonly automatedFindingCode: FindingCode;
      readonly correctedFindingCode: FindingCode;
      readonly reason: ReviewReason;
      readonly occurredAt: string;
      readonly note?: string;
    }
  | {
      readonly outcome: 'inconclusive';
      readonly reviewerName: string;
      readonly automatedFindingCode: FindingCode;
      readonly reason: ReviewReason;
      readonly occurredAt: string;
      readonly note?: string;
    };

export interface InvestigationOutcome {
  readonly ledgerFacts: readonly LedgerFact[];
  readonly contractResult: EvidenceContractResult;
  readonly findingCode: FindingCode;
  readonly policyVersion: string;
  readonly decision: InvestigationDecision;
  readonly decisionReason: DecisionReason;
  readonly capabilityFailure?: CapabilityFailure;
  readonly explanation: FindingExplanation;
  /**
   * The latest improvement attempt for this outcome. Not carried over when an
   * intake update recomputes the outcome, because it was grounded in the old one.
   */
  readonly explanationImprovement?: ExplanationImprovementOutcome;
}

export interface Investigation {
  readonly id: string;
  readonly state: InvestigationState;
  readonly revision: number;
  readonly createdAt: string;
  readonly intake: FulfillmentIntake;
  readonly outcome?: InvestigationOutcome;
  readonly failureReason?: string;
  /**
   * Oldest first. Kept beside `outcome`, not inside it, so reviews survive an
   * intake update that replaces the outcome.
   */
  readonly reviews: readonly HumanReview[];
}

/**
 * One record in the append-only Investigation Audit Trail (ADR-0034).
 * `explanation_improvement_requested` and `review_appended` carry only their
 * own payload because they cannot change intake, state or outcome.
 */
export type InvestigationEvent =
  | {
      readonly kind: 'investigation_created';
      readonly investigationId: string;
      readonly occurredAt: string;
      readonly intake: FulfillmentIntake;
      readonly state: InvestigationState;
      readonly outcome?: InvestigationOutcome;
      readonly failureReason?: string;
    }
  | {
      readonly kind: 'intake_updated';
      readonly investigationId: string;
      readonly occurredAt: string;
      readonly intake: FulfillmentIntake;
      readonly state: InvestigationState;
      readonly outcome?: InvestigationOutcome;
      readonly failureReason?: string;
    }
  | {
      readonly kind: 'explanation_improvement_requested';
      readonly investigationId: string;
      readonly occurredAt: string;
      readonly result: ExplanationImprovementOutcome;
    }
  | {
      readonly kind: 'review_appended';
      readonly investigationId: string;
      readonly occurredAt: string;
      readonly review: HumanReview;
    };

/**
 * Folds the audit trail into the Current Investigation projection. Pure: the
 * same events always rebuild the same projection, and `revision` is the
 * number of events.
 */
export function foldInvestigationEvents(
  events: readonly InvestigationEvent[],
): Investigation | undefined {
  let projection: Omit<Investigation, 'revision'> | undefined;

  for (const event of events) {
    if (event.kind === 'investigation_created') {
      projection = {
        id: event.investigationId,
        state: event.state,
        createdAt: event.occurredAt,
        intake: event.intake,
        outcome: event.outcome,
        failureReason: event.failureReason,
        reviews: [],
      };
      continue;
    }
    if (event.kind === 'intake_updated' && projection) {
      projection = {
        ...projection,
        state: event.state,
        intake: event.intake,
        outcome: event.outcome,
        failureReason: event.failureReason,
      };
      continue;
    }
    if (event.kind === 'explanation_improvement_requested' && projection?.outcome) {
      projection = {
        ...projection,
        outcome: { ...projection.outcome, explanationImprovement: event.result },
      };
      continue;
    }
    if (event.kind === 'review_appended' && projection) {
      projection = {
        ...projection,
        reviews: [...projection.reviews, event.review],
      };
    }
  }

  return projection ? { ...projection, revision: events.length } : undefined;
}

/**
 * A capability failure leaves no ledger for the Finding Policy to evaluate, so
 * it is mapped here to a completed outcome with `requires_specialist_review`,
 * not a `failed` state (ADR-0037).
 */
export function buildInvestigationOutcome(
  playbookResult: FulfillmentPlaybookResult,
): InvestigationOutcome {
  if (playbookResult.kind === 'insufficient-evidence') {
    const { failure } = playbookResult;
    return {
      ledgerFacts: [],
      contractResult: 'insufficient',
      findingCode: 'ROOT_CAUSE_UNDETERMINED',
      policyVersion: FINDING_POLICY_VERSION,
      decision: 'requires_specialist_review',
      decisionReason: 'capability_failed',
      capabilityFailure: failure,
      explanation: buildFindingExplanation({
        findingCode: 'ROOT_CAUSE_UNDETERMINED',
        decisionReason: 'capability_failed',
        capabilityFailure: failure,
      }),
    };
  }

  const findingResult = evaluateFindingPolicy(playbookResult.ledger);
  return {
    ledgerFacts: playbookResult.ledger.facts,
    contractResult: findingResult.contractResult,
    findingCode: findingResult.findingCode,
    policyVersion: findingResult.policyVersion,
    decision: findingResult.decision,
    decisionReason: findingResult.decisionReason,
    explanation: buildFindingExplanation({
      findingCode: findingResult.findingCode,
      decisionReason: findingResult.decisionReason,
    }),
  };
}
