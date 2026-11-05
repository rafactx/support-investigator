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

function userConfirmed<T>(value: T): IntakeField<T> {
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
 * Every field is optional at the type level because Investigation Intake
 * may begin from ticket text, partial structured input, or both: a
 * required value can be genuinely absent, not just unconfirmed. `evaluateIntakeReadiness` is the single place that turns
 * "some fields absent or unconfirmed" into either a ready confirmed intake
 * or a list of gaps — nothing else in this module re-derives readiness.
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

/**
 * The single narrowing seam between a possibly-incomplete
 * `FulfillmentIntake` and the fully-confirmed shape the Fulfillment
 * Playbook requires. Account Scope has no special case here beyond being
 * one of the required fields — it reaches this function only ever as
 * `source: 'user'` because nothing that builds a `FulfillmentIntake` from
 * ticket text is allowed to populate it.
 */
/** Narrows a field already proven present by the caller's own gap check, rather than casting past the type. */
function requireFieldValue<T>(field: IntakeField<T> | undefined, name: IntakeFieldName): T {
  if (!field) {
    throw new Error(`Unreachable: evaluateIntakeReadiness already verified "${name}" is present.`);
  }
  return field.value;
}

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

/**
 * Builds a `FulfillmentIntake` where every field is explicit and
 * user-confirmed ("confirmed Account Scope, SKU, seller, quantity and
 * destination values"). A model proposing any of these fields, with
 * `source: 'model'` and `confirmed: false` until N2 confirms it, is handled
 * by the intake flow instead.
 */
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
 * `POST /investigations/:id/explanations`'s outcome:
 * `accepted` means the model's proposal passed the grounding check and
 * `improvedExplanation` is now the improved-on-request explanation;
 * `rejected` means an unsupported claim or citation was caught and the
 * deterministic `InvestigationOutcome.explanation` is what N2 still sees —
 * this type never has a variant for "Bedrock unavailable" because that
 * case never reaches the Investigation Audit Trail at all (it short-circuits
 * the route before any command is committed, so a retry is a fresh attempt,
 * not a stale-revision idempotent replay of a failure).
 */
export type ExplanationImprovementOutcome =
  | { readonly status: 'accepted'; readonly improvedExplanation: ImprovedExplanation }
  | { readonly status: 'rejected'; readonly reason: string };

/**
 * CONTEXT.md's canonical Review Reason: why a Human Review corrected a
 * Finding or remained inconclusive (missing evidence, blocked access,
 * conflicting evidence) — or, for a diagnosis the supported taxonomy
 * cannot represent, `outside_supported_playbook`. Never
 * free text: qualitative context belongs in a review's optional `note`
 * instead ("optional reviewer notes separated from canonical Finding and
 * Review Reason fields").
 */
export type ReviewReason =
  | 'missing_evidence'
  | 'blocked_access'
  | 'conflicting_evidence'
  | 'outside_supported_playbook';

/**
 * `POST /investigations/:id/reviews`'s outcome:
 * `confirmed` endorses the automated Finding as-is; `corrected` replaces it
 * with a code from the same supported taxonomy (`FindingCode`) — nothing
 * requires it to differ from the automated one, only that it stays within
 * the taxonomy. An unsupported diagnosis has no `corrected` shape to hold
 * it, so a reviewer with a cause outside the playbook has only
 * `inconclusive` with `outside_supported_playbook` available (AC2 is
 * enforced structurally by this union, not by extra cross-field
 * validation); `inconclusive` records
 * that no supported Finding could be confirmed and always carries a
 * canonical `reason`. `automatedFindingCode` is captured from
 * `InvestigationOutcome.findingCode` at the moment this review is
 * appended — not re-read from the Investigation later — so a subsequent
 * intake correction that reruns the playbook can never
 * retroactively change what an already-appended review is understood to
 * have evaluated (AC3: "the automated Finding and previous reviews remain
 * immutable").
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
   * The latest accepted or rejected Bedrock-improved-explanation attempt
   * for *this* outcome. Absent until N2 requests one.
   * Deliberately not carried forward when a later `intake_updated` event
   * recomputes `outcome` via `buildInvestigationOutcome` — a prior
   * improvement was grounded in the Finding/Decision/Ledger this specific
   * outcome held, and those can change under a re-run playbook, so letting
   * it survive onto a new outcome would silently misattribute it.
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
   * The append-only Human Review history, oldest first.
   * Lives beside `outcome`, never nested inside it: a later `intake_updated`
   * event replaces `outcome` wholesale when the playbook reruns (the
   * intake PATCH has no state guard), and reviews must survive that
   * unchanged — they describe what N2 evaluated at the time, not a
   * property of whatever outcome happens to be current.
   */
  readonly reviews: readonly HumanReview[];
}

/**
 * One record in the append-only Investigation Audit Trail (ADR-0034).
 * `investigation_created` starts an investigation's history;
 * `intake_updated` records a confirmation, completion or correction of
 * intake that resumed (or re-paused) the same Investigation —
 * `PATCH /investigations/:id/intake`. `explanation_improvement_requested`
 * is `POST /investigations/:id/explanations`: it never carries
 * its own `intake`/`state`, because requesting an improved explanation can
 * neither change intake nor move an Investigation out of `completed` — it
 * only ever attaches an `ExplanationImprovementOutcome` to the outcome
 * that was already there. `review_appended` is
 * `POST /investigations/:id/reviews`: it carries only the new `review` —
 * never `intake`/`state`/`outcome` — because appending a Human Review can
 * change none of those.
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
 * Folds an Investigation Audit Trail into the Current Investigation
 * projection. Pure and total — the same event array always rebuilds the
 * same projection — so `investigation-repository.ts` never carries a
 * second, independently-mutated source of truth alongside history. This is
 * a real reduce over every event, not a lookup of the first
 * `investigation_created`: a later `intake_updated` must overwrite intake,
 * state, outcome and failure reason, or a correction would silently vanish
 * from `GET /investigations/:id` while `revision` (the count of applied
 * events) kept climbing.
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
 * Maps the deterministic Fulfillment Playbook's result to a durable
 * Investigation outcome. A capability `insufficient-evidence` result never
 * reaches `evaluateFindingPolicy` — there is no ledger to evaluate — so
 * this function, not the Finding Policy, owns the one Investigation
 * Decision branch ADR-0037 requires but `finding-policy.ts`'s pure ledger
 * evaluation has no ledger to derive: "capability permission/failure is an
 * auditable `completed` outcome with `requires_specialist_review`, not a
 * technical `failed` state."
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
