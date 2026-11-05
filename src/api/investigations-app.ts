import { createHash, randomUUID } from 'node:crypto';
import { Hono } from 'hono';
import { z } from 'zod';
import type { CapabilityName } from '../capabilities/types.ts';
import type {
  AppendReviewResult,
  CreateInvestigationResult,
  InvestigationRepository,
  RequestExplanationImprovementResult,
  UpdateIntakeResult,
} from '../domain/investigation-repository.ts';
import {
  buildInvestigationOutcome,
  evaluateIntakeReadiness,
  modelProposed,
  SUPPORTED_SYMPTOM_CODE,
  type ExplanationImprovementOutcome,
  type FulfillmentIntake,
  type HumanReview,
  type IntakeField,
  type Investigation,
  type IntakeGap,
  type IntakeReadiness,
  type ReviewReason,
} from '../domain/investigation.ts';
import { FINDING_CODES, type FindingCode } from '../domain/finding-policy.ts';
import {
  buildAllowedPlaceholders,
  buildExplanationImprovementRequest,
  checkExplanationGrounding,
} from '../domain/explanation-improvement.ts';
import {
  executeFulfillmentPlaybook,
  type FulfillmentPlaybookCapabilities,
  type FulfillmentPlaybookRuntime,
} from '../domain/fulfillment-playbook.ts';
import {
  createFakeLanguageAssistance,
  fixedFieldsScript,
} from '../language-assistance/fake-language-assistance.ts';
import type { ExtractableIntakeField, LanguageAssistance } from '../language-assistance/types.ts';
import { errorBody } from './http-errors.ts';

export interface InvestigationsDeps {
  readonly capabilities: FulfillmentPlaybookCapabilities;
  readonly repository: InvestigationRepository;
  /**
   * Defaults to a no-op fake that never proposes anything — a deployment
   * that never wires a real `LanguageAssistance` still runs, it just never
   * fills a gap from ticket text and always reports
   * explanation improvement as unavailable, degrading straight to the
   * deterministic explanation.
   */
  readonly languageAssistance?: LanguageAssistance;
  readonly now?: () => string;
  readonly createInvestigationId?: () => string;
  readonly createCapabilityCallId?: (capability: CapabilityName) => string;
  /**
   * Receives only allowlisted operational fields. The production Lambda
   * serializes these as JSON, while tests can observe them without replacing
   * global console methods. Raw ticket text and provider payloads never
   * enter this shape.
   */
  readonly log?: (entry: InvestigationLogEntry) => void;
}

export interface InvestigationLogEntry {
  readonly event:
    | 'capability_called'
    | 'capability_observed'
    | 'capability_unavailable'
    | 'investigation_created'
    | 'language_assistance_unavailable'
    | 'unhandled_error';
  readonly investigationId?: string;
  readonly capability?: CapabilityName;
  readonly capabilityCallId?: string;
  readonly state?: Investigation['state'];
  /** A privacy-safe operational classification; never an arbitrary error message. */
  readonly errorKind?: 'access_denied' | 'validation' | 'unknown';
}

function classifyUnexpectedError(error: unknown): NonNullable<InvestigationLogEntry['errorKind']> {
  const name = error instanceof Error ? error.name : '';
  if (/accessdenied|unauthorized/i.test(name)) return 'access_denied';
  if (/validation/i.test(name)) return 'validation';
  return 'unknown';
}

const NO_OP_LANGUAGE_ASSISTANCE: LanguageAssistance = createFakeLanguageAssistance(fixedFieldsScript({}));

/**
 * Hard input-size caps. Ticket text is model input on a public demo, so its
 * cap bounds both prompt cost and abuse (ADR-0047); identifiers and notes
 * are capped so nothing unbounded reaches durable storage.
 */
export const TICKET_TEXT_MAX_LENGTH = 4_000;
export const IDENTIFIER_MAX_LENGTH = 128;
export const REVIEW_NOTE_MAX_LENGTH = 2_000;

const AccountScopeInputSchema = z.strictObject({ accountId: z.string().min(1).max(IDENTIFIER_MAX_LENGTH) });

/**
 * `POST /investigations`'s request body: ticket text,
 * explicit structured intake, or both. Every structured field is optional
 * because a required value may be genuinely missing until Language
 * Assistance proposes it (from `ticketText`) or N2 supplies it later via
 * `PATCH /investigations/:id/intake`. `accountScope` is still a plain
 * structured field here, never derived from `ticketText` — nothing in
 * this route's extraction path ever asks Language Assistance for it
 * (AC2).
 */
const CreateInvestigationRequestSchema = z
  .strictObject({
    symptomCode: z.literal(SUPPORTED_SYMPTOM_CODE),
    ticketText: z.string().min(1).max(TICKET_TEXT_MAX_LENGTH).optional(),
    accountScope: AccountScopeInputSchema.optional(),
    skuId: z.string().min(1).max(IDENTIFIER_MAX_LENGTH).optional(),
    seller: z.string().min(1).max(IDENTIFIER_MAX_LENGTH).optional(),
    quantity: z.number().int().positive().optional(),
    destinationPostalCode: z.string().min(1).max(IDENTIFIER_MAX_LENGTH).optional(),
  })
  .refine(
    (request) =>
      request.ticketText !== undefined ||
      request.accountScope !== undefined ||
      request.skuId !== undefined ||
      request.seller !== undefined ||
      request.quantity !== undefined ||
      request.destinationPostalCode !== undefined,
    { message: 'Provide ticketText, structured intake, or both' },
  );
export type CreateInvestigationRequest = z.infer<typeof CreateInvestigationRequestSchema>;

/**
 * A one-way digest of `ticketText`, never the raw text itself (AC6: ticket
 * text "is neither persisted nor logged"). It still lets an exact retry
 * with the same ticket text be recognized apart from a conflicting reuse
 * of the same `Idempotency-Key` with different ticket text — normalizing
 * whitespace/case first so two byte-identical-in-meaning retries hash the
 * same way.
 */
function ticketTextDigest(ticketText: string | undefined): string | null {
  if (ticketText === undefined) {
    return null;
  }
  return createHash('sha256').update(ticketText.trim().toLowerCase()).digest('hex');
}

/**
 * A deterministic fingerprint of the accepted request body, used only to
 * tell an exact idempotent retry (AC5) apart from a conflicting reuse of
 * the same `Idempotency-Key`. Field order is fixed by this tuple, not by
 * object key order, so it never depends on how `JSON.stringify` happens to
 * serialize an object.
 */
function fingerprint(request: CreateInvestigationRequest): string {
  return JSON.stringify([
    request.symptomCode,
    request.accountScope?.accountId ?? null,
    request.skuId ?? null,
    request.seller ?? null,
    request.quantity ?? null,
    request.destinationPostalCode ?? null,
    ticketTextDigest(request.ticketText),
  ]);
}

function userField<T>(value: T): IntakeField<T> {
  return { value, source: 'user', confirmed: true };
}

/**
 * The one non-Account-Scope field set, shared by every place that needs
 * it: which fields `buildIntake` may ask Language Assistance to propose,
 * and which field names `PATCH /investigations/:id/intake`'s `confirm`
 * array may name (`CONFIRMABLE_FIELDS` below is this same array, reused —
 * not redeclared — so the two lists can't drift apart).
 */
const NON_ACCOUNT_SCOPE_INTAKE_FIELDS = ['skuId', 'seller', 'quantity', 'destinationPostalCode'] as const;
const PROPOSABLE_FIELDS: readonly ExtractableIntakeField[] = NON_ACCOUNT_SCOPE_INTAKE_FIELDS;

/**
 * Merges explicit structured intake with a Language Assistance proposal
 * scoped to exactly the fields still missing after explicit values are
 * applied ("explicit structured values always take
 * precedence over model proposals"). Account Scope is built solely from
 * `request.accountScope` — it is never one of the fields requested from
 * `languageAssistance.extractIntake`, so nothing downstream can even
 * receive a model-proposed Account Scope to (mis)handle (AC2). When
 * `languageAssistance` reports `unavailable`, the still-missing fields
 * simply stay absent and the Investigation falls back to `awaiting_input`
 * instead of throwing (AC7).
 */
export async function buildIntake(
  request: CreateInvestigationRequest,
  languageAssistance: LanguageAssistance,
): Promise<FulfillmentIntake> {
  const explicitSkuId = request.skuId !== undefined ? userField(request.skuId) : undefined;
  const explicitSeller = request.seller !== undefined ? userField(request.seller) : undefined;
  const explicitQuantity = request.quantity !== undefined ? userField(request.quantity) : undefined;
  const explicitDestination =
    request.destinationPostalCode !== undefined ? userField(request.destinationPostalCode) : undefined;

  const missingProposableFields = PROPOSABLE_FIELDS.filter(
    (field) =>
      (field === 'skuId' && !explicitSkuId) ||
      (field === 'seller' && !explicitSeller) ||
      (field === 'quantity' && !explicitQuantity) ||
      (field === 'destinationPostalCode' && !explicitDestination),
  );

  const proposed =
    request.ticketText && missingProposableFields.length > 0
      ? await languageAssistance.extractIntake({ ticketText: request.ticketText, fields: missingProposableFields })
      : { kind: 'extracted' as const, fields: {} };

  const proposedFields = proposed.kind === 'extracted' ? proposed.fields : {};

  return {
    symptomCode: SUPPORTED_SYMPTOM_CODE,
    accountScope: request.accountScope ? userField({ accountId: request.accountScope.accountId }) : undefined,
    skuId: explicitSkuId ?? (proposedFields.skuId !== undefined ? modelProposed(proposedFields.skuId) : undefined),
    seller: explicitSeller ?? (proposedFields.seller !== undefined ? modelProposed(proposedFields.seller) : undefined),
    quantity:
      explicitQuantity ?? (proposedFields.quantity !== undefined ? modelProposed(proposedFields.quantity) : undefined),
    destinationPostalCode:
      explicitDestination ??
      (proposedFields.destinationPostalCode !== undefined
        ? modelProposed(proposedFields.destinationPostalCode)
        : undefined),
  };
}

/**
 * The wire representation of a Current Investigation (AC2): identity,
 * state, revision, intake provenance, Ledger Facts, Evidence Contract
 * Result, automated Finding, Investigation Decision, Decision Reason and
 * the deterministic Source Pack explanation. `capabilityFailure` is
 * surfaced as its own field precisely when it explains an otherwise-empty
 * `ledgerFacts` array, rather than the client having to infer "empty
 * evidence" as "nothing happened". Never includes ticket text or a raw
 * provider payload (AC7) — there is no field here that could carry one.
 *
 * Exported so `web/`'s API client type-imports this exact shape instead of
 * hand-copying it.
 */
export interface InvestigationResponse {
  readonly id: string;
  readonly state: Investigation['state'];
  readonly revision: number;
  readonly createdAt: string;
  readonly intake: Investigation['intake'];
  readonly evidence: {
    readonly ledgerFacts: NonNullable<Investigation['outcome']>['ledgerFacts'];
    readonly contractResult: NonNullable<Investigation['outcome']>['contractResult'];
    readonly capabilityFailure: NonNullable<Investigation['outcome']>['capabilityFailure'] | null;
  } | null;
  readonly finding: {
    readonly code: NonNullable<Investigation['outcome']>['findingCode'];
    readonly policyVersion: string;
  } | null;
  readonly decision: {
    readonly outcome: NonNullable<Investigation['outcome']>['decision'];
    readonly reason: NonNullable<Investigation['outcome']>['decisionReason'];
  } | null;
  readonly explanation: NonNullable<Investigation['outcome']>['explanation'] | null;
  /**
   * The latest accepted-or-rejected Bedrock-improved-explanation attempt
   * for the current outcome: `null` until N2
   * requests one via `POST /investigations/:id/explanations`, and never
   * populated by `GET /investigations/:id` itself. `accepted` carries
   * `improvedExplanation` alongside — never in place of — `explanation`
   * above, which always stays the deterministic Source Pack explanation.
   */
  readonly explanationImprovement: ExplanationImprovementOutcome | null;
  readonly failureReason: string | null;
  /**
   * Present exactly when `state === 'awaiting_input'`:
   * which required fields are missing or hold an unconfirmed model
   * proposal, so the UI can require N2 confirmation or replacement per
   * field instead of guessing from `intake` alone. Recomputed from
   * `intake` on every read via `evaluateIntakeReadiness` rather than
   * stored, so it can never drift from the state it describes.
   */
  readonly intakeGaps: readonly IntakeGap[] | null;
  /**
   * The append-only Human Review history, oldest first.
   * `finding.code` above always stays the automated code — a `corrected`
   * review never rewrites it — so N2 can compare system judgment with
   * human judgment (user story 26) directly from this array.
   */
  readonly reviews: readonly HumanReview[];
  /**
   * The Investigation's current Reviewed Finding, eligible for the future
   * CX Intelligence Loop — `null` while the Finding remains
   * an Unreviewed Signal (no review yet, or the latest review is
   * `inconclusive`). Derived from `reviews` on every read rather than
   * stored (the same "recomputed on read" rule `intakeGaps` already
   * follows), and always from the *latest* review: a later review can
   * supersede an earlier one, so eligibility must track the current
   * verdict, not "was ever confirmed". `code` is the corrected code for a
   * `corrected` review and the automated code for a `confirmed` one.
   */
  readonly reviewedFinding: { readonly code: FindingCode; readonly outcome: 'confirmed' | 'corrected'; readonly reviewerName: string } | null;
}

function latestReviewedFinding(reviews: readonly HumanReview[]): InvestigationResponse['reviewedFinding'] {
  const latest = reviews[reviews.length - 1];
  if (!latest || latest.outcome === 'inconclusive') {
    return null;
  }
  return {
    code: latest.outcome === 'corrected' ? latest.correctedFindingCode : latest.automatedFindingCode,
    outcome: latest.outcome,
    reviewerName: latest.reviewerName,
  };
}

function toInvestigationResponse(investigation: Investigation): InvestigationResponse {
  const { outcome } = investigation;
  const readiness = evaluateIntakeReadiness(investigation.id, investigation.intake);
  return {
    id: investigation.id,
    state: investigation.state,
    revision: investigation.revision,
    createdAt: investigation.createdAt,
    intake: investigation.intake,
    evidence: outcome
      ? {
          ledgerFacts: outcome.ledgerFacts,
          contractResult: outcome.contractResult,
          capabilityFailure: outcome.capabilityFailure ?? null,
        }
      : null,
    finding: outcome ? { code: outcome.findingCode, policyVersion: outcome.policyVersion } : null,
    decision: outcome ? { outcome: outcome.decision, reason: outcome.decisionReason } : null,
    explanation: outcome ? outcome.explanation : null,
    explanationImprovement: outcome?.explanationImprovement ?? null,
    failureReason: investigation.failureReason ?? null,
    intakeGaps: readiness.kind === 'awaiting_input' ? readiness.gaps : null,
    reviews: investigation.reviews,
    reviewedFinding: latestReviewedFinding(investigation.reviews),
  };
}

const CONFIRMABLE_FIELDS = NON_ACCOUNT_SCOPE_INTAKE_FIELDS;
type ConfirmableField = ExtractableIntakeField;

/**
 * `PATCH /investigations/:id/intake`'s request body:
 * confirms, completes or corrects intake. `expectedRevision` is required
 * optimistic concurrency, not an afterthought. `confirm` names
 * already-proposed fields N2 approves as-is (their `source` stays
 * `'model'`, only `confirmed` flips to `true`); a field also present as an
 * explicit value is always a correction/completion (`source: 'user'`),
 * which wins over a same-named entry in `confirm`. There is no
 * `accountScope` entry in `confirm` — Account Scope is either already
 * `source: 'user'` or absent; "confirming" it from anywhere else is not a
 * question this schema can even pose (AC2).
 */
const PatchIntakeRequestSchema = z.strictObject({
  expectedRevision: z.number().int().nonnegative(),
  accountScope: AccountScopeInputSchema.optional(),
  skuId: z.string().min(1).max(IDENTIFIER_MAX_LENGTH).optional(),
  seller: z.string().min(1).max(IDENTIFIER_MAX_LENGTH).optional(),
  quantity: z.number().int().positive().optional(),
  destinationPostalCode: z.string().min(1).max(IDENTIFIER_MAX_LENGTH).optional(),
  confirm: z.array(z.enum(CONFIRMABLE_FIELDS)).optional(),
});
type PatchIntakeRequest = z.infer<typeof PatchIntakeRequestSchema>;

/**
 * `investigationId` is deliberately the first element: the shared
 * `idempotencyIndex` (`investigation-repository.ts`) is one flat map
 * keyed only by `idempotencyKey`, not scoped per resource, so two
 * different investigations patched with the same key and an
 * otherwise-identical body must still fingerprint differently — without
 * `investigationId` here, the second request would resolve as an "exact
 * retry" of the first and return the wrong investigation's representation
 * instead of a structured conflict (AC5).
 */
function patchIntakeFingerprint(investigationId: string, request: PatchIntakeRequest): string {
  return JSON.stringify([
    investigationId,
    request.expectedRevision,
    request.accountScope?.accountId ?? null,
    request.skuId ?? null,
    request.seller ?? null,
    request.quantity ?? null,
    request.destinationPostalCode ?? null,
    [...(request.confirm ?? [])].sort(),
  ]);
}

/**
 * `POST /investigations/:id/explanations`'s request body: only
 * `expectedRevision`, the same required optimistic-concurrency value
 * `PATCH /investigations/:id/intake` requires — there is nothing
 * else for a caller to supply, since the model input is built entirely
 * from the Investigation's own current outcome.
 */
const RequestExplanationImprovementSchema = z.strictObject({
  expectedRevision: z.number().int().nonnegative(),
});
type RequestExplanationImprovementRequest = z.infer<typeof RequestExplanationImprovementSchema>;

/**
 * A leading `'explanation-improvement'` tag plus `investigationId`
 * (the same scoping fix `patchIntakeFingerprint` needed, applied from the
 * start here): the shared `idempotencyIndex` is one flat map keyed only by
 * `idempotencyKey`, so this fingerprint must be unambiguous both across
 * investigations and against `POST`/`PATCH`'s own fingerprint shapes.
 */
function explanationImprovementFingerprint(investigationId: string, request: RequestExplanationImprovementRequest): string {
  return JSON.stringify(['explanation-improvement', investigationId, request.expectedRevision]);
}

const REVIEW_REASONS = [
  'missing_evidence',
  'blocked_access',
  'conflicting_evidence',
  'outside_supported_playbook',
] as const satisfies readonly ReviewReason[];
const ReviewReasonSchema = z.enum(REVIEW_REASONS);

const REVIEWER_NAME_MAX_LENGTH = 80;
const ReviewerNameSchema = z.string().trim().min(1).max(REVIEWER_NAME_MAX_LENGTH);

/**
 * `POST /investigations/:id/reviews`'s request body:
 * `confirmed` needs only a declared `reviewerName`; `corrected` and
 * `inconclusive` also require a canonical `reason` (CONTEXT.md's Review
 * Reason explains why a review corrected a Finding or remained
 * inconclusive). `correctedFindingCode` is restricted to `FINDING_CODES` —
 * the same taxonomy `finding-policy.ts` evaluates against — so an
 * unsupported diagnosis is structurally unrepresentable as a correction;
 * the only place for it is `inconclusive` with `outside_supported_playbook`
 * (AC2, enforced here by the schema rather than extra cross-field
 * validation). `note` is optional on every outcome (CONTEXT.md: "optional
 * reviewer notes separated from canonical Finding and Review Reason
 * fields").
 */
const AppendReviewRequestSchema = z.discriminatedUnion('outcome', [
  z.strictObject({
    outcome: z.literal('confirmed'),
    expectedRevision: z.number().int().nonnegative(),
    reviewerName: ReviewerNameSchema,
    note: z.string().min(1).max(REVIEW_NOTE_MAX_LENGTH).optional(),
  }),
  z.strictObject({
    outcome: z.literal('corrected'),
    expectedRevision: z.number().int().nonnegative(),
    reviewerName: ReviewerNameSchema,
    correctedFindingCode: z.enum(FINDING_CODES),
    reason: ReviewReasonSchema,
    note: z.string().min(1).max(REVIEW_NOTE_MAX_LENGTH).optional(),
  }),
  z.strictObject({
    outcome: z.literal('inconclusive'),
    expectedRevision: z.number().int().nonnegative(),
    reviewerName: ReviewerNameSchema,
    reason: ReviewReasonSchema,
    note: z.string().min(1).max(REVIEW_NOTE_MAX_LENGTH).optional(),
  }),
]);
type AppendReviewRequest = z.infer<typeof AppendReviewRequestSchema>;

/**
 * A leading `'review'` tag plus `investigationId`, and every body field.
 * Unlike `explanationImprovementFingerprint` (whose entire body is
 * `expectedRevision`), this request also carries `reviewerName`, `reason`,
 * `correctedFindingCode` and `note` — all of them must be part of the
 * fingerprint, or reusing a key with a different `reviewerName` (say)
 * would be misread as an exact retry instead of AC4's conflicting-payload
 * reuse.
 */
function reviewFingerprint(investigationId: string, request: AppendReviewRequest): string {
  return JSON.stringify([
    'review',
    investigationId,
    request.expectedRevision,
    request.outcome,
    request.reviewerName,
    request.outcome === 'corrected' ? request.correctedFindingCode : null,
    request.outcome === 'confirmed' ? null : request.reason,
    request.note ?? null,
  ]);
}

/**
 * Builds the durable `HumanReview` from a validated request.
 * `automatedFindingCode` is supplied by the caller from the Investigation's
 * *current* outcome at append time — this function never reads it from
 * anywhere else, so it can't drift from what the route actually checked.
 */
function buildHumanReview(
  request: AppendReviewRequest,
  automatedFindingCode: FindingCode,
  occurredAt: string,
): HumanReview {
  if (request.outcome === 'confirmed') {
    return { outcome: 'confirmed', reviewerName: request.reviewerName, automatedFindingCode, occurredAt, note: request.note };
  }
  if (request.outcome === 'corrected') {
    return {
      outcome: 'corrected',
      reviewerName: request.reviewerName,
      automatedFindingCode,
      correctedFindingCode: request.correctedFindingCode,
      reason: request.reason,
      occurredAt,
      note: request.note,
    };
  }
  return {
    outcome: 'inconclusive',
    reviewerName: request.reviewerName,
    automatedFindingCode,
    reason: request.reason,
    occurredAt,
    note: request.note,
  };
}

function mergeConfirmableField<T>(
  field: ConfirmableField,
  explicitValue: T | undefined,
  currentField: IntakeField<T> | undefined,
  confirmSet: ReadonlySet<ConfirmableField>,
): IntakeField<T> | undefined {
  if (explicitValue !== undefined) {
    return userField(explicitValue);
  }
  if (confirmSet.has(field) && currentField) {
    return { ...currentField, confirmed: true };
  }
  return currentField;
}

/**
 * Applies a `PATCH /investigations/:id/intake` request onto the current
 * intake: an explicit value always corrects/completes a field
 * (`source: 'user'`), `confirm` promotes an existing model proposal to
 * confirmed without changing who supplied it, and anything neither
 * explicit nor confirmed passes through unchanged.
 */
function mergeIntake(current: FulfillmentIntake, request: PatchIntakeRequest): FulfillmentIntake {
  const confirmSet = new Set<ConfirmableField>(request.confirm ?? []);
  return {
    symptomCode: current.symptomCode,
    accountScope: request.accountScope ? userField({ accountId: request.accountScope.accountId }) : current.accountScope,
    skuId: mergeConfirmableField('skuId', request.skuId, current.skuId, confirmSet),
    seller: mergeConfirmableField('seller', request.seller, current.seller, confirmSet),
    quantity: mergeConfirmableField('quantity', request.quantity, current.quantity, confirmSet),
    destinationPostalCode: mergeConfirmableField(
      'destinationPostalCode',
      request.destinationPostalCode,
      current.destinationPostalCode,
      confirmSet,
    ),
  };
}

type PlaybookDecision =
  | { readonly state: 'awaiting_input' }
  | { readonly state: 'completed'; readonly outcome: ReturnType<typeof buildInvestigationOutcome> }
  | { readonly state: 'failed'; readonly failureReason: 'unexpected_error' };

/**
 * The one place that decides whether an intake merge stays paused, runs
 * the Fulfillment Playbook to a Finding, or hits a technical failure —
 * shared by `POST /investigations` and `PATCH /investigations/:id/intake`
 * so this decision (and its ADR-0037 "capability failure is a completed,
 * `requires_specialist_review` outcome, not a technical `failed` state"
 * distinction) exists once, not once per route. Each caller spreads the
 * returned `PlaybookDecision` onto its own create/update command, which
 * already carries `state`/`outcome?`/`failureReason?` as the same
 * optional shape.
 */
async function runPlaybookAndDecideOutcome(
  readiness: IntakeReadiness,
  capabilities: FulfillmentPlaybookCapabilities,
  runtime: {
    now: () => string;
    createCapabilityCallId?: (capability: CapabilityName) => string;
    onCapabilityCall?: FulfillmentPlaybookRuntime['onCapabilityCall'];
  },
  log?: InvestigationsDeps['log'],
): Promise<PlaybookDecision> {
  if (readiness.kind === 'awaiting_input') {
    return { state: 'awaiting_input' };
  }
  try {
    const playbookResult = await executeFulfillmentPlaybook(readiness.confirmed, capabilities, runtime);
    const outcome = buildInvestigationOutcome(playbookResult);
    for (const fact of outcome.ledgerFacts) {
      log?.({
        event: 'capability_observed',
        investigationId: fact.investigationId,
        capability: fact.capability,
        capabilityCallId: fact.capabilityCallId,
      });
    }
    if (outcome.capabilityFailure) {
      log?.({
        event: 'capability_unavailable',
        investigationId: readiness.confirmed.investigationId,
        capability: outcome.capabilityFailure.capability,
      });
    }
    return { state: 'completed', outcome };
  } catch (_error) {
    // Do not serialize an arbitrary thrown value: provider errors can carry
    // request details that this API is explicitly forbidden to persist or log.
    log?.({ event: 'unhandled_error', investigationId: readiness.confirmed.investigationId });
    return { state: 'failed', failureReason: 'unexpected_error' };
  }
}

/**
 * Builds the resource-oriented Investigations API (ADR-0036):
 * `POST /investigations` and `GET /investigations/:id`. Creation runs the
 * Fulfillment Playbook directly against `deps.capabilities` — never
 * through this application's own MCP endpoint (AC3) — and persists through
 * `deps.repository`, the append-only Investigation Audit Trail port
 * (ADR-0034). The sole first-party investigation workflow —
 * the old `/investigate` prototype it once ran alongside is removed with
 * no compatibility layer.
 */
export function createInvestigationsApp(deps: InvestigationsDeps): Hono {
  const app = new Hono();
  const now = deps.now ?? (() => new Date().toISOString());
  const createInvestigationId = deps.createInvestigationId ?? randomUUID;
  const languageAssistance = deps.languageAssistance ?? NO_OP_LANGUAGE_ASSISTANCE;

  app.onError((error, c) => {
    // Keep the log's schema allowlisted even when an unanticipated adapter
    // error reaches Hono. In particular, never log `error.message`.
    deps.log?.({ event: 'unhandled_error', errorKind: classifyUnexpectedError(error) });
    return c.json(errorBody('Internal server error'), 500);
  });

  app.post('/investigations', async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json(errorBody('Request body must be valid JSON'), 400);
    }

    const parsedRequest = CreateInvestigationRequestSchema.safeParse(body);
    if (!parsedRequest.success) {
      const issues = parsedRequest.error.issues.map(
        (issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`,
      );
      return c.json(errorBody('Invalid request body', issues), 400);
    }

    const idempotencyKey = c.req.header('Idempotency-Key');
    if (!idempotencyKey) {
      return c.json(errorBody('The Idempotency-Key header is required'), 400);
    }

    const request = parsedRequest.data;
    const requestFingerprint = fingerprint(request);

    // Pre-check before running any Operational Capability: an exact retry
    // (AC5) must never re-invoke the Fulfillment Playbook.
    const existing = await deps.repository.findByIdempotencyKey(idempotencyKey, requestFingerprint);
    if (existing.kind === 'conflict') {
      return c.json(
        errorBody('Idempotency-Key was already used with a different request body'),
        409,
      );
    }
    if (existing.kind === 'found') {
      return c.json(toInvestigationResponse(existing.investigation), 200);
    }

    const investigationId = createInvestigationId();
    const intake = await buildIntake(request, languageAssistance);
    const occurredAt = now();
    const readiness = evaluateIntakeReadiness(investigationId, intake);

    // Missing, ambiguous or unconfirmed required values create the
    // Investigation in `awaiting_input` without invoking a single
    // Operational Capability.
    const decision = await runPlaybookAndDecideOutcome(readiness, deps.capabilities, {
      now,
      createCapabilityCallId: deps.createCapabilityCallId,
      onCapabilityCall: (call) => deps.log?.({ event: 'capability_called', ...call }),
    }, deps.log);
    const commitResult: CreateInvestigationResult = await deps.repository.createInvestigation({
      investigationId,
      idempotencyKey,
      requestFingerprint,
      occurredAt,
      intake,
      ...decision,
    });

    if (commitResult.kind === 'idempotency-conflict') {
      return c.json(
        errorBody('Idempotency-Key was already used with a different request body'),
        409,
      );
    }
    const status = commitResult.kind === 'created' ? 201 : 200;
    deps.log?.({
      event: 'investigation_created',
      investigationId: commitResult.investigation.id,
      state: commitResult.investigation.state,
    });
    return c.json(toInvestigationResponse(commitResult.investigation), status);
  });

  app.get('/investigations/:id', async (c) => {
    const investigation = await deps.repository.getCurrentInvestigation(c.req.param('id'));
    if (!investigation) {
      return c.json(errorBody('Investigation not found'), 404);
    }
    return c.json(toInvestigationResponse(investigation), 200);
  });

  // Deliberately no `current.state` guard: unlike the explanations route
  // ("available only for completed Investigations"), the intake-correction
  // spec places no state restriction on intake correction — "intake
  // correction resumes the same Investigation and appends an audit
  // record" — so a correction against an already-`completed` Investigation
  // re-runs the playbook and can change its Finding, the same as any other
  // merge that reaches a `ready` readiness.
  app.patch('/investigations/:id/intake', async (c) => {
    const investigationId = c.req.param('id');

    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json(errorBody('Request body must be valid JSON'), 400);
    }

    const parsedRequest = PatchIntakeRequestSchema.safeParse(body);
    if (!parsedRequest.success) {
      const issues = parsedRequest.error.issues.map(
        (issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`,
      );
      return c.json(errorBody('Invalid request body', issues), 400);
    }

    const idempotencyKey = c.req.header('Idempotency-Key');
    if (!idempotencyKey) {
      return c.json(errorBody('The Idempotency-Key header is required'), 400);
    }

    const request = parsedRequest.data;
    const requestFingerprint = patchIntakeFingerprint(investigationId, request);

    // Pre-check before running any Operational Capability, mirroring
    // `POST /investigations`: an exact retry (AC5) must never re-invoke the
    // Fulfillment Playbook.
    const existing = await deps.repository.findByIdempotencyKey(idempotencyKey, requestFingerprint);
    if (existing.kind === 'conflict') {
      return c.json(errorBody('Idempotency-Key was already used with a different request body'), 409);
    }
    if (existing.kind === 'found') {
      return c.json(toInvestigationResponse(existing.investigation), 200);
    }

    const current = await deps.repository.getCurrentInvestigation(investigationId);
    if (!current) {
      return c.json(errorBody('Investigation not found'), 404);
    }

    const mergedIntake = mergeIntake(current.intake, request);
    const occurredAt = now();
    const readiness = evaluateIntakeReadiness(investigationId, mergedIntake);

    const decision = await runPlaybookAndDecideOutcome(readiness, deps.capabilities, {
      now,
      createCapabilityCallId: deps.createCapabilityCallId,
      onCapabilityCall: (call) => deps.log?.({ event: 'capability_called', ...call }),
    }, deps.log);
    const commitResult: UpdateIntakeResult = await deps.repository.updateIntake({
      investigationId,
      idempotencyKey,
      requestFingerprint,
      expectedRevision: request.expectedRevision,
      occurredAt,
      intake: mergedIntake,
      ...decision,
    });

    switch (commitResult.kind) {
      case 'not-found':
        return c.json(errorBody('Investigation not found'), 404);
      case 'idempotency-conflict':
        return c.json(errorBody('Idempotency-Key was already used with a different request body'), 409);
      case 'stale-revision':
        return c.json(
          errorBody(
            `expectedRevision ${request.expectedRevision} is stale; the current revision is ${commitResult.currentRevision}`,
          ),
          409,
        );
      case 'updated':
        return c.json(toInvestigationResponse(commitResult.investigation), 200);
      case 'idempotent-replay':
        return c.json(toInvestigationResponse(commitResult.investigation), 200);
    }
  });

  /**
   * `POST /investigations/:id/explanations`: on explicit N2
   * request, asks Language Assistance for at most one bounded call that
   * improves the wording and next-action guidance of an already-completed
   * Investigation's deterministic explanation — grounded exclusively in
   * confirmed intake, the Evidence Ledger, the Evidence Contract Result,
   * the Finding and the Investigation Decision it already has. Every
   * state/idempotency check below runs *before* `languageAssistance` is
   * ever called, so a request that can't possibly be accepted (wrong
   * state, stale revision, a replayed retry) never spends a model call on
   * it (AC1: "at most one bounded model call per accepted command").
   */
  app.post('/investigations/:id/explanations', async (c) => {
    const investigationId = c.req.param('id');

    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json(errorBody('Request body must be valid JSON'), 400);
    }

    const parsedRequest = RequestExplanationImprovementSchema.safeParse(body);
    if (!parsedRequest.success) {
      const issues = parsedRequest.error.issues.map(
        (issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`,
      );
      return c.json(errorBody('Invalid request body', issues), 400);
    }

    const idempotencyKey = c.req.header('Idempotency-Key');
    if (!idempotencyKey) {
      return c.json(errorBody('The Idempotency-Key header is required'), 400);
    }

    const request = parsedRequest.data;
    const requestFingerprint = explanationImprovementFingerprint(investigationId, request);

    // Pre-check before ever calling Language Assistance, mirroring
    // POST/PATCH: an exact retry must never re-invoke the model.
    const existing = await deps.repository.findByIdempotencyKey(idempotencyKey, requestFingerprint);
    if (existing.kind === 'conflict') {
      return c.json(errorBody('Idempotency-Key was already used with a different request body'), 409);
    }
    if (existing.kind === 'found') {
      return c.json(toInvestigationResponse(existing.investigation), 200);
    }

    const current = await deps.repository.getCurrentInvestigation(investigationId);
    if (!current) {
      return c.json(errorBody('Investigation not found'), 404);
    }

    // Available only for a completed Investigation (AC1) — checked before
    // any model call, not only before commit.
    if (current.state !== 'completed' || !current.outcome) {
      return c.json(errorBody('Explanations are only available for a completed Investigation'), 409);
    }

    // A pre-check ahead of the bounded model call, stricter than
    // POST/PATCH's commit-time-only check: a stale revision is caught here
    // so it never costs a Language Assistance call. `requestExplanationImprovement`
    // still re-checks atomically at commit time as the authoritative guard.
    if (current.revision !== request.expectedRevision) {
      return c.json(
        errorBody(
          `expectedRevision ${request.expectedRevision} is stale; the current revision is ${current.revision}`,
        ),
        409,
      );
    }

    // Unreachable in practice — a `completed` Investigation's intake is
    // always `ready` (the same gate that made it `completed`) — but this
    // narrows to `ConfirmedFulfillmentIntake` without an unsafe cast.
    const readiness = evaluateIntakeReadiness(investigationId, current.intake);
    if (readiness.kind !== 'ready') {
      return c.json(errorBody('Investigation intake is not ready for an explanation improvement'), 409);
    }

    const occurredAt = now();
    // Computed once and reused for both the model request (names only) and
    // the grounding check (names and values) — the same allowlist, never
    // two independently-derived ones that could drift apart.
    const allowedPlaceholders = buildAllowedPlaceholders({
      intake: readiness.confirmed,
      ledgerFacts: current.outcome.ledgerFacts,
      capabilityFailure: current.outcome.capabilityFailure,
    });
    const modelRequest = buildExplanationImprovementRequest({
      findingCode: current.outcome.findingCode,
      decision: current.outcome.decision,
      decisionReason: current.outcome.decisionReason,
      deterministicSummary: current.outcome.explanation.summary,
      placeholders: allowedPlaceholders,
      capabilityFailure: current.outcome.capabilityFailure,
    });

    const modelResult = await languageAssistance.improveExplanation(modelRequest);
    if (modelResult.kind === 'unavailable') {
      // Never committed: AC1's "accepted command" is the
      // idempotency-committed one, and this never reaches that point — a
      // genuine retry after a transient Bedrock failure should attempt the
      // call again, not be blocked by an idempotent replay of a failure
      // forever (AC7's UI fallback needs exactly this: retry just works).
      // The provider's own error text stays out of the response: it can name
      // accounts, gateways or quotas. The log entry carries only the event.
      deps.log?.({ event: 'language_assistance_unavailable', investigationId });
      return c.json(errorBody('Language Assistance is unavailable right now. Please try again later.'), 503);
    }

    const grounding = checkExplanationGrounding(
      modelResult,
      { findingCode: current.outcome.findingCode, placeholders: allowedPlaceholders },
      occurredAt,
    );

    // Unsupported claims or citations reject the improved explanation while
    // preserving the deterministic explanation, Evidence Ledger, Finding
    // and Investigation Decision (AC5) — `result` never touches anything
    // on `current.outcome` other than `explanationImprovement` itself.
    const result: ExplanationImprovementOutcome =
      grounding.kind === 'grounded'
        ? { status: 'accepted', improvedExplanation: grounding.explanation }
        : { status: 'rejected', reason: grounding.reason };

    const commitResult: RequestExplanationImprovementResult = await deps.repository.requestExplanationImprovement({
      investigationId,
      idempotencyKey,
      requestFingerprint,
      expectedRevision: request.expectedRevision,
      occurredAt,
      result,
    });

    switch (commitResult.kind) {
      case 'not-found':
        return c.json(errorBody('Investigation not found'), 404);
      case 'idempotency-conflict':
        return c.json(errorBody('Idempotency-Key was already used with a different request body'), 409);
      case 'stale-revision':
        return c.json(
          errorBody(
            `expectedRevision ${request.expectedRevision} is stale; the current revision is ${commitResult.currentRevision}`,
          ),
          409,
        );
      case 'recorded':
      case 'idempotent-replay':
        return c.json(toInvestigationResponse(commitResult.investigation), 200);
    }
  });

  /**
   * `POST /investigations/:id/reviews`: appends a declared,
   * attributed Human Review to an already-`completed` Investigation
   * without rewriting the automated Finding or any earlier history (AC3).
   * Available only for a `completed` Investigation with an outcome — the
   * same guard `POST /investigations/:id/explanations` uses — because a
   * Human Review evaluates an automated Finding that doesn't exist yet for
   * one still `awaiting_input` or `failed`.
   */
  app.post('/investigations/:id/reviews', async (c) => {
    const investigationId = c.req.param('id');

    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json(errorBody('Request body must be valid JSON'), 400);
    }

    const parsedRequest = AppendReviewRequestSchema.safeParse(body);
    if (!parsedRequest.success) {
      const issues = parsedRequest.error.issues.map(
        (issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`,
      );
      return c.json(errorBody('Invalid request body', issues), 400);
    }

    const idempotencyKey = c.req.header('Idempotency-Key');
    if (!idempotencyKey) {
      return c.json(errorBody('The Idempotency-Key header is required'), 400);
    }

    const request = parsedRequest.data;
    const requestFingerprint = reviewFingerprint(investigationId, request);

    // Pre-check before ever appending, mirroring POST/PATCH/explanations:
    // an exact retry (AC4) must return the already-applied review, never
    // append a second one.
    const existing = await deps.repository.findByIdempotencyKey(idempotencyKey, requestFingerprint);
    if (existing.kind === 'conflict') {
      return c.json(errorBody('Idempotency-Key was already used with a different request body'), 409);
    }
    if (existing.kind === 'found') {
      return c.json(toInvestigationResponse(existing.investigation), 200);
    }

    const current = await deps.repository.getCurrentInvestigation(investigationId);
    if (!current) {
      return c.json(errorBody('Investigation not found'), 404);
    }

    // A Human Review evaluates an automated Finding, which only exists for
    // a completed Investigation — the same restriction the explanations
    // route applies.
    if (current.state !== 'completed' || !current.outcome) {
      return c.json(errorBody('Reviews are only available for a completed Investigation'), 409);
    }

    if (current.revision !== request.expectedRevision) {
      return c.json(
        errorBody(
          `expectedRevision ${request.expectedRevision} is stale; the current revision is ${current.revision}`,
        ),
        409,
      );
    }

    const occurredAt = now();
    const review = buildHumanReview(request, current.outcome.findingCode, occurredAt);

    const commitResult: AppendReviewResult = await deps.repository.appendReview({
      investigationId,
      idempotencyKey,
      requestFingerprint,
      expectedRevision: request.expectedRevision,
      occurredAt,
      review,
    });

    switch (commitResult.kind) {
      case 'not-found':
        return c.json(errorBody('Investigation not found'), 404);
      case 'idempotency-conflict':
        return c.json(errorBody('Idempotency-Key was already used with a different request body'), 409);
      case 'stale-revision':
        return c.json(
          errorBody(
            `expectedRevision ${request.expectedRevision} is stale; the current revision is ${commitResult.currentRevision}`,
          ),
          409,
        );
      case 'appended':
      case 'idempotent-replay':
        return c.json(toInvestigationResponse(commitResult.investigation), 200);
    }
  });

  return app;
}
