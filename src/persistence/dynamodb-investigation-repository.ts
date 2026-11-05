import { createHash } from 'node:crypto';
import { DynamoDBClient, TransactionCanceledException } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  QueryCommand,
  TransactWriteCommand,
  type TransactWriteCommandInput,
} from '@aws-sdk/lib-dynamodb';
import {
  foldInvestigationEvents,
  type Investigation,
  type InvestigationEvent,
} from '../domain/investigation.ts';
import type {
  AppendReviewCommand,
  AppendReviewResult,
  CreateInvestigationCommand,
  CreateInvestigationResult,
  IdempotencyLookup,
  InvestigationRepository,
  RequestExplanationImprovementCommand,
  RequestExplanationImprovementResult,
  UpdateIntakeCommand,
  UpdateIntakeResult,
} from '../domain/investigation-repository.ts';

/** ADR-0035's single-table design: every investigation's items share this partition. */
function investigationPartitionKey(investigationId: string): string {
  return `INV#${investigationId}`;
}

const PROJECTION_SORT_KEY = 'CURRENT';
const EVENT_SORT_KEY_PREFIX = 'EVT#';

/**
 * Zero-padded so `EVT#<revision>#<eventId>` sorts numerically, not
 * lexicographically (EVT#10 after EVT#9, not before). `eventId` is a
 * deterministic digest of the idempotency key, not a random uuid — an
 * exact retry that reaches this function (because it raced the idempotency
 * item's own `attribute_not_exists` check and lost) must derive the *same*
 * SK the first attempt did, so ADR-0035's "inserts the event only if
 * absent" has an actual condition to enforce rather than a random SK that
 * can never collide.
 */
function eventSortKey(revision: number, idempotencyKey: string): string {
  const eventId = createHash('sha256').update(idempotencyKey).digest('hex').slice(0, 32);
  return `${EVENT_SORT_KEY_PREFIX}${String(revision).padStart(10, '0')}#${eventId}`;
}

/**
 * The scoped create-idempotency item ADR-0035 describes ("a scoped key item
 * that points repeated submissions to the original Investigation"). Its own
 * partition — not `INV#<id>` — because an Idempotency-Key arrives before
 * its target investigationId is known to the caller doing the lookup
 * (`findByIdempotencyKey`).
 */
function idempotencyPartitionKey(idempotencyKey: string): string {
  return `IDEMP#${idempotencyKey}`;
}

interface ProjectionItem {
  readonly PK: string;
  readonly SK: typeof PROJECTION_SORT_KEY;
  readonly investigationId: string;
  readonly revision: number;
  /** The materialized `Investigation` (ADR-0034) — read on the normal path so product reads never replay history. */
  readonly investigation: Investigation;
}

interface EventItem {
  readonly PK: string;
  readonly SK: string;
  readonly investigationId: string;
  readonly revision: number;
  readonly event: InvestigationEvent;
}

interface IdempotencyItem {
  readonly PK: string;
  readonly SK: 'RECORD';
  readonly requestFingerprint: string;
  readonly investigationId: string;
}

export interface DynamoDbInvestigationRepositoryConfig {
  readonly tableName: string;
  readonly client?: DynamoDBClient;
}

/**
 * Reads the table name this adapter needs from the environment
 * (`INVESTIGATION_TABLE_NAME`): returns `undefined`, never throws, so the
 * caller (the API Lambda entrypoint, or this module's own
 * integration test) decides what an absent value means.
 */
export function readInvestigationTableName(env: NodeJS.ProcessEnv = process.env): string | undefined {
  return env.INVESTIGATION_TABLE_NAME;
}

/**
 * Reads all `EVT#` items for an investigation, ordered oldest-first by the
 * zero-padded sort key. `getCurrentInvestigation` prefers the materialized
 * `CURRENT` item on the normal path (see `readProjection`); this full scan
 * exists for the commit path (which must fold in the event about to be
 * appended) and for AC6's "reconstructed from immutable historical events
 * and matches the materialized projection" cross-check.
 */
async function queryEvents(
  doc: DynamoDBDocumentClient,
  tableName: string,
  investigationId: string,
): Promise<InvestigationEvent[]> {
  const items: EventItem[] = [];
  let exclusiveStartKey: Record<string, unknown> | undefined;

  do {
    const page = await doc.send(
      new QueryCommand({
        TableName: tableName,
        KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
        ExpressionAttributeValues: {
          ':pk': investigationPartitionKey(investigationId),
          ':prefix': EVENT_SORT_KEY_PREFIX,
        },
        ExclusiveStartKey: exclusiveStartKey,
        // A strongly consistent read, not DynamoDB's eventually-consistent
        // default: `lookupByIdempotencyKey`'s "found" branch and every
        // command's own not-found/stale-revision pre-check depend on
        // seeing a write this same request chain just made (or another
        // request just committed), never a stale replica — a stale read
        // here can misroute a genuine exact retry into
        // `idempotency-conflict` (AC4).
        ConsistentRead: true,
      }),
    );
    items.push(...((page.Items ?? []) as EventItem[]));
    exclusiveStartKey = page.LastEvaluatedKey as Record<string, unknown> | undefined;
  } while (exclusiveStartKey);

  return items.map((item) => item.event);
}

/** The `CURRENT` projection item — the normal product-read path (ADR-0034). */
async function readProjection(
  doc: DynamoDBDocumentClient,
  tableName: string,
  investigationId: string,
): Promise<Investigation | undefined> {
  const result = await doc.send(
    new QueryCommand({
      TableName: tableName,
      KeyConditionExpression: 'PK = :pk AND SK = :sk',
      ExpressionAttributeValues: {
        ':pk': investigationPartitionKey(investigationId),
        ':sk': PROJECTION_SORT_KEY,
      },
      // See `queryEvents`'s own comment: this read must never be stale,
      // since `lookupByIdempotencyKey` folds its result directly into
      // whether a retry is treated as an exact replay.
      ConsistentRead: true,
    }),
  );
  const item = result.Items?.[0] as ProjectionItem | undefined;
  return item?.investigation;
}

/**
 * Resolves an Idempotency-Key to `not-found` (no prior attempt claimed
 * it), `conflict` (claimed, but by a different request payload) or `found`
 * (an exact retry — the claiming investigation's current projection).
 * `record.requestFingerprint !== requestFingerprint` is checked before ever
 * reading the projection, so a same-key/different-payload conflict never
 * depends on whether that investigation's projection happens to exist yet.
 */
async function lookupByIdempotencyKey(
  doc: DynamoDBDocumentClient,
  tableName: string,
  idempotencyKey: string,
  requestFingerprint: string,
): Promise<IdempotencyLookup> {
  const result = await doc.send(
    new QueryCommand({
      TableName: tableName,
      KeyConditionExpression: 'PK = :pk AND SK = :sk',
      ExpressionAttributeValues: {
        ':pk': idempotencyPartitionKey(idempotencyKey),
        ':sk': 'RECORD',
      },
      ConsistentRead: true,
    }),
  );
  const record = (result.Items?.[0] as IdempotencyItem | undefined) ?? undefined;
  if (!record) {
    return { kind: 'not-found' };
  }
  if (record.requestFingerprint !== requestFingerprint) {
    return { kind: 'conflict' };
  }

  const investigation = await readProjection(doc, tableName, record.investigationId);
  return investigation ? { kind: 'found', investigation } : { kind: 'not-found' };
}

type CommitOutcome =
  | { readonly kind: 'committed'; readonly investigation: Investigation }
  | { readonly kind: 'stale-revision' }
  | { readonly kind: 'idempotency-conflict' };

/**
 * Index within `transactItems` (below) that each condition lives at — used
 * to interpret `TransactionCanceledException.CancellationReasons`, which is
 * positionally parallel to the request's own `TransactItems` (AWS's
 * documented contract, not an assumption). Distinguishing which condition
 * failed is what lets a raced idempotent retry return `idempotent-replay`
 * instead of a spurious `stale-revision`.
 */
const EVENT_ITEM_INDEX = 0;
const PROJECTION_ITEM_INDEX = 1;
const IDEMPOTENCY_ITEM_INDEX = 2;

/**
 * Appends one event and atomically advances the projection, all inside a
 * single `TransactWriteItems` call (ADR-0035's "conditionally checks the
 * current revision, inserts the event only if absent and advances the
 * projection atomically"). `expectedRevision` doubles as the projection's
 * optimistic-concurrency guard and, for a brand-new investigation, is
 * asserted absent instead (`attribute_not_exists`).
 *
 * A cancelled transaction is inspected item-by-item via
 * `CancellationReasons` rather than treated as one undifferentiated
 * failure: the idempotency item losing a race (two concurrent exact
 * retries) is `idempotency-conflict`-shaped work for the caller to resolve
 * via `lookupByIdempotencyKey`, not the same outcome as a genuine stale
 * revision.
 */
async function commitEvent(
  doc: DynamoDBDocumentClient,
  tableName: string,
  params: {
    readonly investigationId: string;
    readonly idempotencyKey: string;
    readonly requestFingerprint: string;
    readonly expectedRevision: number;
    readonly event: InvestigationEvent;
    readonly priorEvents: readonly InvestigationEvent[];
  },
): Promise<CommitOutcome> {
  const pk = investigationPartitionKey(params.investigationId);
  const newRevision = params.expectedRevision + 1;
  const events = [...params.priorEvents, params.event];
  const investigation = foldInvestigationEvents(events);
  if (!investigation) {
    throw new Error('Unreachable: the just-appended investigation event failed to fold.');
  }

  const eventItem: EventItem = {
    PK: pk,
    SK: eventSortKey(newRevision, params.idempotencyKey),
    investigationId: params.investigationId,
    revision: newRevision,
    event: params.event,
  };
  const projectionItem: ProjectionItem = {
    PK: pk,
    SK: PROJECTION_SORT_KEY,
    investigationId: params.investigationId,
    revision: newRevision,
    investigation,
  };
  const idempotencyItem: IdempotencyItem = {
    PK: idempotencyPartitionKey(params.idempotencyKey),
    SK: 'RECORD',
    requestFingerprint: params.requestFingerprint,
    investigationId: params.investigationId,
  };

  const transactItems: NonNullable<TransactWriteCommandInput['TransactItems']> = [
    {
      Put: {
        TableName: tableName,
        Item: eventItem,
        ConditionExpression: 'attribute_not_exists(PK)',
      },
    },
    params.expectedRevision === 0
      ? {
          Put: {
            TableName: tableName,
            Item: projectionItem,
            ConditionExpression: 'attribute_not_exists(PK)',
          },
        }
      : {
          Put: {
            TableName: tableName,
            Item: projectionItem,
            ConditionExpression: 'revision = :expectedRevision',
            ExpressionAttributeValues: { ':expectedRevision': params.expectedRevision },
          },
        },
    {
      Put: {
        TableName: tableName,
        Item: idempotencyItem,
        ConditionExpression: 'attribute_not_exists(PK)',
      },
    },
  ];

  try {
    await doc.send(new TransactWriteCommand({ TransactItems: transactItems }));
  } catch (error) {
    if (error instanceof TransactionCanceledException) {
      const reasons = error.CancellationReasons ?? [];
      const idempotencyFailed = reasons[IDEMPOTENCY_ITEM_INDEX]?.Code === 'ConditionalCheckFailed';
      const eventFailed = reasons[EVENT_ITEM_INDEX]?.Code === 'ConditionalCheckFailed';
      const projectionFailed = reasons[PROJECTION_ITEM_INDEX]?.Code === 'ConditionalCheckFailed';
      if (idempotencyFailed || eventFailed) {
        return { kind: 'idempotency-conflict' };
      }
      if (projectionFailed) {
        return { kind: 'stale-revision' };
      }
      // A cancellation with no recognized ConditionalCheckFailed reason
      // (throughput throttling, a validation error on another item) is a
      // genuine unexpected failure this port has no recoverable outcome
      // for — rethrow rather than mis-map it.
      throw error;
    }
    throw error;
  }

  return { kind: 'committed', investigation };
}

/**
 * Resolves a cancelled commit against the authoritative idempotency lookup:
 * a raced exact retry (same key, same fingerprint) becomes
 * `idempotent-replay`; anything else surfaces the outcome `commitEvent`
 * already determined.
 */
async function resolveIdempotencyConflict(
  doc: DynamoDBDocumentClient,
  tableName: string,
  idempotencyKey: string,
  requestFingerprint: string,
): Promise<{ readonly kind: 'idempotent-replay'; readonly investigation: Investigation } | { readonly kind: 'idempotency-conflict' }> {
  const raced = await lookupByIdempotencyKey(doc, tableName, idempotencyKey, requestFingerprint);
  if (raced.kind === 'found') {
    return { kind: 'idempotent-replay', investigation: raced.investigation };
  }
  return { kind: 'idempotency-conflict' };
}

/**
 * The DynamoDB-backed `InvestigationRepository` (ADR-0035): the
 * deployed store behind the same port the in-memory adapter implements for
 * local tests (ADR-0036). Every accepted command appends one immutable
 * `EVT#` item and atomically advances the `CURRENT` projection item inside
 * one `TransactWriteItems` call — never two separate writes a crash could
 * leave half-applied. `findByIdempotencyKey` is read-only (a `Query`, not
 * part of any transaction) — it exists purely as callers' pre-check before
 * running the Fulfillment Playbook; the authoritative guard
 * is the `attribute_not_exists` condition each commit places on its own
 * idempotency and event items.
 */
export function createDynamoDbInvestigationRepository(
  config: DynamoDbInvestigationRepositoryConfig,
): InvestigationRepository {
  const client = config.client ?? new DynamoDBClient({});
  const doc = DynamoDBDocumentClient.from(client, {
    marshallOptions: { removeUndefinedValues: true },
  });
  const tableName = config.tableName;

  return {
    async findByIdempotencyKey(idempotencyKey, requestFingerprint) {
      return lookupByIdempotencyKey(doc, tableName, idempotencyKey, requestFingerprint);
    },

    async createInvestigation(command: CreateInvestigationCommand): Promise<CreateInvestigationResult> {
      const existing = await lookupByIdempotencyKey(doc, tableName, command.idempotencyKey, command.requestFingerprint);
      if (existing.kind === 'conflict') {
        return { kind: 'idempotency-conflict' };
      }
      if (existing.kind === 'found') {
        return { kind: 'idempotent-replay', investigation: existing.investigation };
      }

      const event: InvestigationEvent = {
        kind: 'investigation_created',
        investigationId: command.investigationId,
        occurredAt: command.occurredAt,
        intake: command.intake,
        state: command.state,
        outcome: command.outcome,
        failureReason: command.failureReason,
      };

      const commit = await commitEvent(doc, tableName, {
        investigationId: command.investigationId,
        idempotencyKey: command.idempotencyKey,
        requestFingerprint: command.requestFingerprint,
        expectedRevision: 0,
        event,
        priorEvents: [],
      });

      if (commit.kind === 'idempotency-conflict') {
        return resolveIdempotencyConflict(doc, tableName, command.idempotencyKey, command.requestFingerprint);
      }
      if (commit.kind === 'stale-revision') {
        // A raced concurrent create against the same investigationId lost
        // — this command's own result type has no revision-conflict
        // variant (investigationId is caller-chosen and assumed unclaimed),
        // so surface it as a conflict rather than inventing a new kind.
        return { kind: 'idempotency-conflict' };
      }

      return { kind: 'created', investigation: commit.investigation };
    },

    async updateIntake(command: UpdateIntakeCommand): Promise<UpdateIntakeResult> {
      const priorEvents = await queryEvents(doc, tableName, command.investigationId);
      if (priorEvents.length === 0) {
        return { kind: 'not-found' };
      }

      const existing = await lookupByIdempotencyKey(doc, tableName, command.idempotencyKey, command.requestFingerprint);
      if (existing.kind === 'conflict') {
        return { kind: 'idempotency-conflict' };
      }
      if (existing.kind === 'found') {
        return { kind: 'idempotent-replay', investigation: existing.investigation };
      }

      if (priorEvents.length !== command.expectedRevision) {
        return { kind: 'stale-revision', currentRevision: priorEvents.length };
      }

      const event: InvestigationEvent = {
        kind: 'intake_updated',
        investigationId: command.investigationId,
        occurredAt: command.occurredAt,
        intake: command.intake,
        state: command.state,
        outcome: command.outcome,
        failureReason: command.failureReason,
      };

      const commit = await commitEvent(doc, tableName, {
        investigationId: command.investigationId,
        idempotencyKey: command.idempotencyKey,
        requestFingerprint: command.requestFingerprint,
        expectedRevision: command.expectedRevision,
        event,
        priorEvents,
      });

      if (commit.kind === 'idempotency-conflict') {
        const resolved = await resolveIdempotencyConflict(doc, tableName, command.idempotencyKey, command.requestFingerprint);
        return resolved;
      }
      if (commit.kind === 'stale-revision') {
        const currentEvents = await queryEvents(doc, tableName, command.investigationId);
        return { kind: 'stale-revision', currentRevision: currentEvents.length };
      }

      return { kind: 'updated', investigation: commit.investigation };
    },

    async requestExplanationImprovement(
      command: RequestExplanationImprovementCommand,
    ): Promise<RequestExplanationImprovementResult> {
      const priorEvents = await queryEvents(doc, tableName, command.investigationId);
      if (priorEvents.length === 0) {
        return { kind: 'not-found' };
      }

      const existing = await lookupByIdempotencyKey(doc, tableName, command.idempotencyKey, command.requestFingerprint);
      if (existing.kind === 'conflict') {
        return { kind: 'idempotency-conflict' };
      }
      if (existing.kind === 'found') {
        return { kind: 'idempotent-replay', investigation: existing.investigation };
      }

      if (priorEvents.length !== command.expectedRevision) {
        return { kind: 'stale-revision', currentRevision: priorEvents.length };
      }

      const event: InvestigationEvent = {
        kind: 'explanation_improvement_requested',
        investigationId: command.investigationId,
        occurredAt: command.occurredAt,
        result: command.result,
      };

      const commit = await commitEvent(doc, tableName, {
        investigationId: command.investigationId,
        idempotencyKey: command.idempotencyKey,
        requestFingerprint: command.requestFingerprint,
        expectedRevision: command.expectedRevision,
        event,
        priorEvents,
      });

      if (commit.kind === 'idempotency-conflict') {
        const resolved = await resolveIdempotencyConflict(doc, tableName, command.idempotencyKey, command.requestFingerprint);
        return resolved;
      }
      if (commit.kind === 'stale-revision') {
        const currentEvents = await queryEvents(doc, tableName, command.investigationId);
        return { kind: 'stale-revision', currentRevision: currentEvents.length };
      }

      return { kind: 'recorded', investigation: commit.investigation };
    },

    async appendReview(command: AppendReviewCommand): Promise<AppendReviewResult> {
      const priorEvents = await queryEvents(doc, tableName, command.investigationId);
      if (priorEvents.length === 0) {
        return { kind: 'not-found' };
      }

      const existing = await lookupByIdempotencyKey(doc, tableName, command.idempotencyKey, command.requestFingerprint);
      if (existing.kind === 'conflict') {
        return { kind: 'idempotency-conflict' };
      }
      if (existing.kind === 'found') {
        return { kind: 'idempotent-replay', investigation: existing.investigation };
      }

      if (priorEvents.length !== command.expectedRevision) {
        return { kind: 'stale-revision', currentRevision: priorEvents.length };
      }

      const event: InvestigationEvent = {
        kind: 'review_appended',
        investigationId: command.investigationId,
        occurredAt: command.occurredAt,
        review: command.review,
      };

      const commit = await commitEvent(doc, tableName, {
        investigationId: command.investigationId,
        idempotencyKey: command.idempotencyKey,
        requestFingerprint: command.requestFingerprint,
        expectedRevision: command.expectedRevision,
        event,
        priorEvents,
      });

      if (commit.kind === 'idempotency-conflict') {
        const resolved = await resolveIdempotencyConflict(doc, tableName, command.idempotencyKey, command.requestFingerprint);
        return resolved;
      }
      if (commit.kind === 'stale-revision') {
        const currentEvents = await queryEvents(doc, tableName, command.investigationId);
        return { kind: 'stale-revision', currentRevision: currentEvents.length };
      }

      return { kind: 'appended', investigation: commit.investigation };
    },

    async getCurrentInvestigation(investigationId) {
      return readProjection(doc, tableName, investigationId);
    },
  };
}
