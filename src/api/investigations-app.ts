import { createHash, randomUUID } from 'node:crypto';
import { type Context, Hono } from 'hono';
import { z } from 'zod';
import type { CapabilityName } from '../capabilities/types.ts';
import type { InvestigationRepository } from '../domain/investigation-repository.ts';
import {
  buildInvestigationOutcome,
  evaluateIntakeReadiness,
  modelProposed,
  SUPPORTED_SYMPTOM_CODE,
  userConfirmed,
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
   * Defaults to a fake that never proposes anything and reports explanation
   * improvement as unavailable, so the deterministic path still runs.
   */
  readonly languageAssistance?: LanguageAssistance;
  readonly now?: () => string;
  readonly createInvestigationId?: () => string;
  readonly createCapabilityCallId?: (capability: CapabilityName) => string;
  /** Receives only allowlisted operational fields, never ticket text or provider payloads. */
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
  /** A classification, never an arbitrary error message. */
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
 * Ticket text is model input on a public demo, so its cap bounds prompt cost
 * and abuse (ADR-0047). Identifiers and notes are capped so nothing unbounded
 * reaches storage.
 */
export const TICKET_TEXT_MAX_LENGTH = 4_000;
const IDENTIFIER_MAX_LENGTH = 128;
const REVIEW_NOTE_MAX_LENGTH = 2_000;
const REVIEWER_NAME_MAX_LENGTH = 80;

const IDEMPOTENCY_CONFLICT = 'Idempotency-Key was already used with a different request body';

const IdentifierSchema = z.string().min(1).max(IDENTIFIER_MAX_LENGTH);
const AccountScopeInputSchema = z.strictObject({ accountId: IdentifierSchema });
const ExpectedRevisionSchema = z.number().int().nonnegative();

/**
 * Ticket text, structured intake, or both. Every structured field is optional
 * because it may be proposed from `ticketText` or supplied later through
 * `PATCH /investigations/:id/intake`. Account Scope is only ever taken from
 * the structured field; it is never requested from Language Assistance.
 */
const CreateInvestigationRequestSchema = z
  .strictObject({
    symptomCode: z.literal(SUPPORTED_SYMPTOM_CODE),
    ticketText: z.string().min(1).max(TICKET_TEXT_MAX_LENGTH).optional(),
    accountScope: AccountScopeInputSchema.optional(),
    skuId: IdentifierSchema.optional(),
    seller: IdentifierSchema.optional(),
    quantity: z.number().int().positive().optional(),
    destinationPostalCode: IdentifierSchema.optional(),
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
 * Ticket text enters the idempotency fingerprint only as a digest, so it is
 * never stored (ADR-0043). Whitespace and case are normalized first.
 */
function ticketTextDigest(ticketText: string | undefined): string | null {
  if (ticketText === undefined) {
    return null;
  }
  return createHash('sha256').update(ticketText.trim().toLowerCase()).digest('hex');
}

/**
 * The idempotency index is one flat map keyed by `Idempotency-Key`, so every
 * fingerprint is a fixed positional tuple and the per-resource ones carry a
 * route tag or the investigation id. Without the id, the same key and body
 * sent to two investigations would replay the first one's response.
 */
function createFingerprint(request: CreateInvestigationRequest): string {
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

function proposedField<T>(value: T | undefined): IntakeField<T> | undefined {
  return value !== undefined ? modelProposed(value) : undefined;
}

/** The intake fields Language Assistance may propose and N2 may confirm. Account Scope is not one of them. */
const PROPOSABLE_FIELDS = [
  'skuId',
  'seller',
  'quantity',
  'destinationPostalCode',
] as const satisfies readonly ExtractableIntakeField[];

/**
 * Explicit structured values take precedence. Language Assistance is asked
 * only for the fields still missing; if it is unavailable they stay missing
 * and the Investigation waits for input.
 */
export async function buildIntake(
  request: CreateInvestigationRequest,
  languageAssistance: LanguageAssistance,
): Promise<FulfillmentIntake> {
  const missingFields = PROPOSABLE_FIELDS.filter((field) => request[field] === undefined);

  const proposed =
    request.ticketText && missingFields.length > 0
      ? await languageAssistance.extractIntake({ ticketText: request.ticketText, fields: missingFields })
      : undefined;
  const proposedFields = proposed?.kind === 'extracted' ? proposed.fields : {};

  return {
    symptomCode: SUPPORTED_SYMPTOM_CODE,
    accountScope: request.accountScope ? userConfirmed({ accountId: request.accountScope.accountId }) : undefined,
    skuId: request.skuId !== undefined ? userConfirmed(request.skuId) : proposedField(proposedFields.skuId),
    seller: request.seller !== undefined ? userConfirmed(request.seller) : proposedField(proposedFields.seller),
    quantity: request.quantity !== undefined ? userConfirmed(request.quantity) : proposedField(proposedFields.quantity),
    destinationPostalCode:
      request.destinationPostalCode !== undefined
        ? userConfirmed(request.destinationPostalCode)
        : proposedField(proposedFields.destinationPostalCode),
  };
}

/**
 * The wire shape of a Current Investigation. It has no field that could carry
 * ticket text or a raw provider payload. `web/` type-imports it.
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
    /** Set when a capability failure explains an empty `ledgerFacts`. */
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
  /** Always the deterministic Source Pack explanation. */
  readonly explanation: NonNullable<Investigation['outcome']>['explanation'] | null;
  /** The latest improvement attempt for the current outcome, or `null` if none was requested. */
  readonly explanationImprovement: ExplanationImprovementOutcome | null;
  readonly failureReason: string | null;
  /** Set only in `awaiting_input`. Recomputed from `intake` on every read (ADR-0044). */
  readonly intakeGaps: readonly IntakeGap[] | null;
  /** Human Reviews, oldest first. `finding.code` stays the automated code. */
  readonly reviews: readonly HumanReview[];
  /**
   * Derived from the latest review: `null` with no review or when the latest
   * is `inconclusive`. For `corrected`, `code` is the corrected code.
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

/**
 * Confirms, completes or corrects intake. `confirm` names model proposals N2
 * approves as-is (`source` stays `'model'`); an explicit value for the same
 * field wins and becomes `source: 'user'`. Account Scope cannot be confirmed,
 * only supplied.
 */
const PatchIntakeRequestSchema = z.strictObject({
  expectedRevision: ExpectedRevisionSchema,
  accountScope: AccountScopeInputSchema.optional(),
  skuId: IdentifierSchema.optional(),
  seller: IdentifierSchema.optional(),
  quantity: z.number().int().positive().optional(),
  destinationPostalCode: IdentifierSchema.optional(),
  confirm: z.array(z.enum(PROPOSABLE_FIELDS)).optional(),
});
type PatchIntakeRequest = z.infer<typeof PatchIntakeRequestSchema>;

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

/** The model input is built from the Investigation's own outcome, so the body carries only the revision. */
const RequestExplanationImprovementSchema = z.strictObject({
  expectedRevision: ExpectedRevisionSchema,
});
type RequestExplanationImprovementRequest = z.infer<typeof RequestExplanationImprovementSchema>;

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
const ReviewerNameSchema = z.string().trim().min(1).max(REVIEWER_NAME_MAX_LENGTH);
const ReviewNoteSchema = z.string().min(1).max(REVIEW_NOTE_MAX_LENGTH).optional();

/**
 * `correctedFindingCode` is limited to `FINDING_CODES`, so a cause outside
 * the playbook can only be recorded as `inconclusive` with
 * `outside_supported_playbook`.
 */
const AppendReviewRequestSchema = z.discriminatedUnion('outcome', [
  z.strictObject({
    outcome: z.literal('confirmed'),
    expectedRevision: ExpectedRevisionSchema,
    reviewerName: ReviewerNameSchema,
    note: ReviewNoteSchema,
  }),
  z.strictObject({
    outcome: z.literal('corrected'),
    expectedRevision: ExpectedRevisionSchema,
    reviewerName: ReviewerNameSchema,
    correctedFindingCode: z.enum(FINDING_CODES),
    reason: ReviewReasonSchema,
    note: ReviewNoteSchema,
  }),
  z.strictObject({
    outcome: z.literal('inconclusive'),
    expectedRevision: ExpectedRevisionSchema,
    reviewerName: ReviewerNameSchema,
    reason: ReviewReasonSchema,
    note: ReviewNoteSchema,
  }),
]);
type AppendReviewRequest = z.infer<typeof AppendReviewRequestSchema>;

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

/** `automatedFindingCode` is captured at append time, so a later rerun cannot change what a review evaluated. */
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
  field: ExtractableIntakeField,
  explicitValue: T | undefined,
  currentField: IntakeField<T> | undefined,
  confirmSet: ReadonlySet<ExtractableIntakeField>,
): IntakeField<T> | undefined {
  if (explicitValue !== undefined) {
    return userConfirmed(explicitValue);
  }
  if (confirmSet.has(field) && currentField) {
    return { ...currentField, confirmed: true };
  }
  return currentField;
}

function mergeIntake(current: FulfillmentIntake, request: PatchIntakeRequest): FulfillmentIntake {
  const confirmSet = new Set<ExtractableIntakeField>(request.confirm ?? []);
  return {
    symptomCode: current.symptomCode,
    accountScope: request.accountScope ? userConfirmed({ accountId: request.accountScope.accountId }) : current.accountScope,
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
 * Shared by create and intake update. A capability failure is a completed
 * outcome that needs specialist review, not a `failed` state (ADR-0037);
 * `failed` is reserved for unexpected errors.
 */
async function runPlaybookAndDecideOutcome(
  readiness: IntakeReadiness,
  capabilities: FulfillmentPlaybookCapabilities,
  runtime: FulfillmentPlaybookRuntime,
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
    // Provider errors can carry request details, so the error is not logged.
    log?.({ event: 'unhandled_error', investigationId: readiness.confirmed.investigationId });
    return { state: 'failed', failureReason: 'unexpected_error' };
  }
}

interface Command<T> {
  readonly request: T;
  readonly idempotencyKey: string;
}

/** Parses the JSON body against `schema` and requires an `Idempotency-Key` header. */
async function readCommand<T>(c: Context, schema: z.ZodType<T>): Promise<Command<T> | Response> {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json(errorBody('Request body must be valid JSON'), 400);
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`);
    return c.json(errorBody('Invalid request body', issues), 400);
  }

  const idempotencyKey = c.req.header('Idempotency-Key');
  if (!idempotencyKey) {
    return c.json(errorBody('The Idempotency-Key header is required'), 400);
  }
  return { request: parsed.data, idempotencyKey };
}

function staleRevision(c: Context, expectedRevision: number, currentRevision: number): Response {
  return c.json(
    errorBody(`expectedRevision ${expectedRevision} is stale; the current revision is ${currentRevision}`),
    409,
  );
}

type CommitResult =
  | { readonly kind: 'updated' | 'recorded' | 'appended' | 'idempotent-replay'; readonly investigation: Investigation }
  | { readonly kind: 'idempotency-conflict' }
  | { readonly kind: 'stale-revision'; readonly currentRevision: number }
  | { readonly kind: 'not-found' };

function commitResponse(c: Context, result: CommitResult, expectedRevision: number): Response {
  switch (result.kind) {
    case 'not-found':
      return c.json(errorBody('Investigation not found'), 404);
    case 'idempotency-conflict':
      return c.json(errorBody(IDEMPOTENCY_CONFLICT), 409);
    case 'stale-revision':
      return staleRevision(c, expectedRevision, result.currentRevision);
    default:
      return c.json(toInvestigationResponse(result.investigation), 200);
  }
}

/**
 * The resource-oriented Investigations API (ADR-0036). The playbook calls
 * `deps.capabilities` directly, never this app's own MCP endpoint (ADR-0039),
 * and every write goes through the append-only audit trail (ADR-0034).
 *
 * Every write route checks idempotency first, so an exact retry never re-runs
 * capabilities or the model, and a reused key with a different body is a 409.
 */
export function createInvestigationsApp(deps: InvestigationsDeps): Hono {
  const app = new Hono();
  const now = deps.now ?? (() => new Date().toISOString());
  const createInvestigationId = deps.createInvestigationId ?? randomUUID;
  const languageAssistance = deps.languageAssistance ?? NO_OP_LANGUAGE_ASSISTANCE;
  const playbookRuntime: FulfillmentPlaybookRuntime = {
    now,
    createCapabilityCallId: deps.createCapabilityCallId,
    onCapabilityCall: (call) => deps.log?.({ event: 'capability_called', ...call }),
  };

  /** The stored response for an exact retry, a 409 for a conflicting reuse, or `undefined` for a new key. */
  async function replayOrConflict(c: Context, idempotencyKey: string, fingerprint: string): Promise<Response | undefined> {
    const existing = await deps.repository.findByIdempotencyKey(idempotencyKey, fingerprint);
    if (existing.kind === 'conflict') {
      return c.json(errorBody(IDEMPOTENCY_CONFLICT), 409);
    }
    if (existing.kind === 'found') {
      return c.json(toInvestigationResponse(existing.investigation), 200);
    }
    return undefined;
  }

  app.onError((error, c) => {
    // Never log `error.message`; keep the log schema allowlisted.
    deps.log?.({ event: 'unhandled_error', errorKind: classifyUnexpectedError(error) });
    return c.json(errorBody('Internal server error'), 500);
  });

  app.post('/investigations', async (c) => {
    const command = await readCommand(c, CreateInvestigationRequestSchema);
    if (command instanceof Response) return command;
    const { request, idempotencyKey } = command;
    const requestFingerprint = createFingerprint(request);

    const replay = await replayOrConflict(c, idempotencyKey, requestFingerprint);
    if (replay) return replay;

    const investigationId = createInvestigationId();
    const intake = await buildIntake(request, languageAssistance);
    const occurredAt = now();
    const readiness = evaluateIntakeReadiness(investigationId, intake);
    const decision = await runPlaybookAndDecideOutcome(readiness, deps.capabilities, playbookRuntime, deps.log);
    const commitResult = await deps.repository.createInvestigation({
      investigationId,
      idempotencyKey,
      requestFingerprint,
      occurredAt,
      intake,
      ...decision,
    });

    if (commitResult.kind === 'idempotency-conflict') {
      return c.json(errorBody(IDEMPOTENCY_CONFLICT), 409);
    }
    deps.log?.({
      event: 'investigation_created',
      investigationId: commitResult.investigation.id,
      state: commitResult.investigation.state,
    });
    return c.json(toInvestigationResponse(commitResult.investigation), commitResult.kind === 'created' ? 201 : 200);
  });

  app.get('/investigations/:id', async (c) => {
    const investigation = await deps.repository.getCurrentInvestigation(c.req.param('id'));
    if (!investigation) {
      return c.json(errorBody('Investigation not found'), 404);
    }
    return c.json(toInvestigationResponse(investigation), 200);
  });

  // No state guard: correcting a completed Investigation's intake re-runs the
  // playbook and can change its Finding.
  app.patch('/investigations/:id/intake', async (c) => {
    const investigationId = c.req.param('id');
    const command = await readCommand(c, PatchIntakeRequestSchema);
    if (command instanceof Response) return command;
    const { request, idempotencyKey } = command;
    const requestFingerprint = patchIntakeFingerprint(investigationId, request);

    const replay = await replayOrConflict(c, idempotencyKey, requestFingerprint);
    if (replay) return replay;

    const current = await deps.repository.getCurrentInvestigation(investigationId);
    if (!current) {
      return c.json(errorBody('Investigation not found'), 404);
    }

    const mergedIntake = mergeIntake(current.intake, request);
    const occurredAt = now();
    const readiness = evaluateIntakeReadiness(investigationId, mergedIntake);
    const decision = await runPlaybookAndDecideOutcome(readiness, deps.capabilities, playbookRuntime, deps.log);
    const commitResult = await deps.repository.updateIntake({
      investigationId,
      idempotencyKey,
      requestFingerprint,
      expectedRevision: request.expectedRevision,
      occurredAt,
      intake: mergedIntake,
      ...decision,
    });
    return commitResponse(c, commitResult, request.expectedRevision);
  });

  // At most one bounded model call per accepted request. Every state,
  // revision and idempotency check runs before the call.
  app.post('/investigations/:id/explanations', async (c) => {
    const investigationId = c.req.param('id');
    const command = await readCommand(c, RequestExplanationImprovementSchema);
    if (command instanceof Response) return command;
    const { request, idempotencyKey } = command;
    const requestFingerprint = explanationImprovementFingerprint(investigationId, request);

    const replay = await replayOrConflict(c, idempotencyKey, requestFingerprint);
    if (replay) return replay;

    const current = await deps.repository.getCurrentInvestigation(investigationId);
    if (!current) {
      return c.json(errorBody('Investigation not found'), 404);
    }
    if (current.state !== 'completed' || !current.outcome) {
      return c.json(errorBody('Explanations are only available for a completed Investigation'), 409);
    }
    // Checked here so a stale request never costs a model call; the
    // repository re-checks atomically at commit time.
    if (current.revision !== request.expectedRevision) {
      return staleRevision(c, request.expectedRevision, current.revision);
    }
    // A completed Investigation's intake is always ready; this narrows the type.
    const readiness = evaluateIntakeReadiness(investigationId, current.intake);
    if (readiness.kind !== 'ready') {
      return c.json(errorBody('Investigation intake is not ready for an explanation improvement'), 409);
    }

    const occurredAt = now();
    // One allowlist for both the model request and the grounding check.
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
      // Not committed, so a retry with the same key calls the model again.
      // The provider's error text can name accounts or quotas and stays out.
      deps.log?.({ event: 'language_assistance_unavailable', investigationId });
      return c.json(errorBody('Language Assistance is unavailable right now. Please try again later.'), 503);
    }

    // A rejected improvement leaves the deterministic explanation, ledger,
    // Finding and Decision as they were.
    const grounding = checkExplanationGrounding(
      modelResult,
      { findingCode: current.outcome.findingCode, placeholders: allowedPlaceholders },
      occurredAt,
    );
    const result: ExplanationImprovementOutcome =
      grounding.kind === 'grounded'
        ? { status: 'accepted', improvedExplanation: grounding.explanation }
        : { status: 'rejected', reason: grounding.reason };

    const commitResult = await deps.repository.requestExplanationImprovement({
      investigationId,
      idempotencyKey,
      requestFingerprint,
      expectedRevision: request.expectedRevision,
      occurredAt,
      result,
    });
    return commitResponse(c, commitResult, request.expectedRevision);
  });

  // Appends a Human Review without rewriting the automated Finding or
  // earlier reviews. Only a completed Investigation has a Finding to review.
  app.post('/investigations/:id/reviews', async (c) => {
    const investigationId = c.req.param('id');
    const command = await readCommand(c, AppendReviewRequestSchema);
    if (command instanceof Response) return command;
    const { request, idempotencyKey } = command;
    const requestFingerprint = reviewFingerprint(investigationId, request);

    const replay = await replayOrConflict(c, idempotencyKey, requestFingerprint);
    if (replay) return replay;

    const current = await deps.repository.getCurrentInvestigation(investigationId);
    if (!current) {
      return c.json(errorBody('Investigation not found'), 404);
    }
    if (current.state !== 'completed' || !current.outcome) {
      return c.json(errorBody('Reviews are only available for a completed Investigation'), 409);
    }
    if (current.revision !== request.expectedRevision) {
      return staleRevision(c, request.expectedRevision, current.revision);
    }

    const occurredAt = now();
    const commitResult = await deps.repository.appendReview({
      investigationId,
      idempotencyKey,
      requestFingerprint,
      expectedRevision: request.expectedRevision,
      occurredAt,
      review: buildHumanReview(request, current.outcome.findingCode, occurredAt),
    });
    return commitResponse(c, commitResult, request.expectedRevision);
  });

  return app;
}
