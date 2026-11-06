import {
  foldInvestigationEvents,
  type ExplanationImprovementOutcome,
  type FulfillmentIntake,
  type HumanReview,
  type Investigation,
  type InvestigationEvent,
  type InvestigationOutcome,
  type InvestigationState,
} from './investigation.ts';

export interface CreateInvestigationCommand {
  readonly investigationId: string;
  readonly idempotencyKey: string;
  /** A caller-computed fingerprint of the accepted request body — this module never re-derives it. */
  readonly requestFingerprint: string;
  readonly occurredAt: string;
  readonly intake: FulfillmentIntake;
  readonly state: InvestigationState;
  readonly outcome?: InvestigationOutcome;
  readonly failureReason?: string;
}

export type IdempotencyLookup =
  | { readonly kind: 'not-found' }
  | { readonly kind: 'found'; readonly investigation: Investigation }
  | { readonly kind: 'conflict' };

export type CreateInvestigationResult =
  | { readonly kind: 'created'; readonly investigation: Investigation }
  | { readonly kind: 'idempotent-replay'; readonly investigation: Investigation }
  | { readonly kind: 'idempotency-conflict' };

/**
 * `PATCH /investigations/:id/intake`. `expectedRevision` guards against a
 * concurrent edit; the idempotency key guards against a retry.
 */
export interface UpdateIntakeCommand {
  readonly investigationId: string;
  readonly idempotencyKey: string;
  readonly requestFingerprint: string;
  readonly expectedRevision: number;
  readonly occurredAt: string;
  readonly intake: FulfillmentIntake;
  readonly state: InvestigationState;
  readonly outcome?: InvestigationOutcome;
  readonly failureReason?: string;
}

export type UpdateIntakeResult =
  | { readonly kind: 'updated'; readonly investigation: Investigation }
  | { readonly kind: 'idempotent-replay'; readonly investigation: Investigation }
  | { readonly kind: 'idempotency-conflict' }
  | { readonly kind: 'stale-revision'; readonly currentRevision: number }
  | { readonly kind: 'not-found' };

/** `POST /investigations/:id/explanations`. Cannot change intake or state. */
export interface RequestExplanationImprovementCommand {
  readonly investigationId: string;
  readonly idempotencyKey: string;
  readonly requestFingerprint: string;
  readonly expectedRevision: number;
  readonly occurredAt: string;
  readonly result: ExplanationImprovementOutcome;
}

export type RequestExplanationImprovementResult =
  | { readonly kind: 'recorded'; readonly investigation: Investigation }
  | { readonly kind: 'idempotent-replay'; readonly investigation: Investigation }
  | { readonly kind: 'idempotency-conflict' }
  | { readonly kind: 'stale-revision'; readonly currentRevision: number }
  | { readonly kind: 'not-found' };

/** `POST /investigations/:id/reviews`. Cannot change intake, state or outcome. */
export interface AppendReviewCommand {
  readonly investigationId: string;
  readonly idempotencyKey: string;
  readonly requestFingerprint: string;
  readonly expectedRevision: number;
  readonly occurredAt: string;
  readonly review: HumanReview;
}

export type AppendReviewResult =
  | { readonly kind: 'appended'; readonly investigation: Investigation }
  | { readonly kind: 'idempotent-replay'; readonly investigation: Investigation }
  | { readonly kind: 'idempotency-conflict' }
  | { readonly kind: 'stale-revision'; readonly currentRevision: number }
  | { readonly kind: 'not-found' };

/**
 * The append-only Investigation Audit Trail port (ADR-0034/0035). The Current
 * Investigation is a projection over the events, never a separately mutated
 * record. `findByIdempotencyKey` is a read-only pre-check so an exact retry
 * never re-runs capabilities; each write repeats the check atomically.
 *
 * The in-memory, D1 and DynamoDB implementations all pass
 * `investigation-repository.contract.ts`.
 */
export interface InvestigationRepository {
  findByIdempotencyKey(idempotencyKey: string, requestFingerprint: string): Promise<IdempotencyLookup>;
  createInvestigation(command: CreateInvestigationCommand): Promise<CreateInvestigationResult>;
  updateIntake(command: UpdateIntakeCommand): Promise<UpdateIntakeResult>;
  requestExplanationImprovement(
    command: RequestExplanationImprovementCommand,
  ): Promise<RequestExplanationImprovementResult>;
  appendReview(command: AppendReviewCommand): Promise<AppendReviewResult>;
  getCurrentInvestigation(investigationId: string): Promise<Investigation | undefined>;
}

interface IdempotencyRecord {
  readonly requestFingerprint: string;
  readonly investigationId: string;
}

function lookup(
  idempotencyIndex: ReadonlyMap<string, IdempotencyRecord>,
  eventsById: ReadonlyMap<string, InvestigationEvent[]>,
  idempotencyKey: string,
  requestFingerprint: string,
): IdempotencyLookup {
  const record = idempotencyIndex.get(idempotencyKey);
  if (!record) {
    return { kind: 'not-found' };
  }
  if (record.requestFingerprint !== requestFingerprint) {
    return { kind: 'conflict' };
  }
  const investigation = foldInvestigationEvents(eventsById.get(record.investigationId) ?? []);
  return investigation ? { kind: 'found', investigation } : { kind: 'not-found' };
}

/**
 * In-memory implementation for tests and local runs. Each method runs
 * synchronously, so concurrent handlers cannot interleave the idempotency
 * check with the write.
 */
export function createInMemoryInvestigationRepository(): InvestigationRepository {
  const eventsById = new Map<string, InvestigationEvent[]>();
  const idempotencyIndex = new Map<string, IdempotencyRecord>();

  return {
    async findByIdempotencyKey(idempotencyKey, requestFingerprint) {
      return lookup(idempotencyIndex, eventsById, idempotencyKey, requestFingerprint);
    },

    async createInvestigation(command) {
      const existing = lookup(idempotencyIndex, eventsById, command.idempotencyKey, command.requestFingerprint);
      if (existing.kind === 'conflict') {
        return { kind: 'idempotency-conflict' };
      }
      if (existing.kind === 'found') {
        return { kind: 'idempotent-replay', investigation: existing.investigation };
      }

      idempotencyIndex.set(command.idempotencyKey, {
        requestFingerprint: command.requestFingerprint,
        investigationId: command.investigationId,
      });
      const event: InvestigationEvent = {
        kind: 'investigation_created',
        investigationId: command.investigationId,
        occurredAt: command.occurredAt,
        intake: command.intake,
        state: command.state,
        outcome: command.outcome,
        failureReason: command.failureReason,
      };
      eventsById.set(command.investigationId, [event]);

      const investigation = foldInvestigationEvents([event]);
      if (!investigation) {
        throw new Error('Unreachable: the just-created investigation event failed to fold.');
      }
      return { kind: 'created', investigation };
    },

    async updateIntake(command) {
      const events = eventsById.get(command.investigationId);
      if (!events) {
        return { kind: 'not-found' };
      }

      const existing = lookup(idempotencyIndex, eventsById, command.idempotencyKey, command.requestFingerprint);
      if (existing.kind === 'conflict') {
        return { kind: 'idempotency-conflict' };
      }
      if (existing.kind === 'found') {
        return { kind: 'idempotent-replay', investigation: existing.investigation };
      }

      if (events.length !== command.expectedRevision) {
        return { kind: 'stale-revision', currentRevision: events.length };
      }

      idempotencyIndex.set(command.idempotencyKey, {
        requestFingerprint: command.requestFingerprint,
        investigationId: command.investigationId,
      });
      const event: InvestigationEvent = {
        kind: 'intake_updated',
        investigationId: command.investigationId,
        occurredAt: command.occurredAt,
        intake: command.intake,
        state: command.state,
        outcome: command.outcome,
        failureReason: command.failureReason,
      };
      events.push(event);

      const investigation = foldInvestigationEvents(events);
      if (!investigation) {
        throw new Error('Unreachable: the just-updated investigation event failed to fold.');
      }
      return { kind: 'updated', investigation };
    },

    async requestExplanationImprovement(command) {
      const events = eventsById.get(command.investigationId);
      if (!events) {
        return { kind: 'not-found' };
      }

      const existing = lookup(idempotencyIndex, eventsById, command.idempotencyKey, command.requestFingerprint);
      if (existing.kind === 'conflict') {
        return { kind: 'idempotency-conflict' };
      }
      if (existing.kind === 'found') {
        return { kind: 'idempotent-replay', investigation: existing.investigation };
      }

      if (events.length !== command.expectedRevision) {
        return { kind: 'stale-revision', currentRevision: events.length };
      }

      idempotencyIndex.set(command.idempotencyKey, {
        requestFingerprint: command.requestFingerprint,
        investigationId: command.investigationId,
      });
      const event: InvestigationEvent = {
        kind: 'explanation_improvement_requested',
        investigationId: command.investigationId,
        occurredAt: command.occurredAt,
        result: command.result,
      };
      events.push(event);

      const investigation = foldInvestigationEvents(events);
      if (!investigation) {
        throw new Error('Unreachable: the just-updated investigation event failed to fold.');
      }
      return { kind: 'recorded', investigation };
    },

    async appendReview(command) {
      const events = eventsById.get(command.investigationId);
      if (!events) {
        return { kind: 'not-found' };
      }

      const existing = lookup(idempotencyIndex, eventsById, command.idempotencyKey, command.requestFingerprint);
      if (existing.kind === 'conflict') {
        return { kind: 'idempotency-conflict' };
      }
      if (existing.kind === 'found') {
        return { kind: 'idempotent-replay', investigation: existing.investigation };
      }

      if (events.length !== command.expectedRevision) {
        return { kind: 'stale-revision', currentRevision: events.length };
      }

      idempotencyIndex.set(command.idempotencyKey, {
        requestFingerprint: command.requestFingerprint,
        investigationId: command.investigationId,
      });
      const event: InvestigationEvent = {
        kind: 'review_appended',
        investigationId: command.investigationId,
        occurredAt: command.occurredAt,
        review: command.review,
      };
      events.push(event);

      const investigation = foldInvestigationEvents(events);
      if (!investigation) {
        throw new Error('Unreachable: the just-updated investigation event failed to fold.');
      }
      return { kind: 'appended', investigation };
    },

    async getCurrentInvestigation(investigationId) {
      return foldInvestigationEvents(eventsById.get(investigationId) ?? []);
    },
  };
}
