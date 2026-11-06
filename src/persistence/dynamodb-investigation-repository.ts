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
 * Zero-padded so `EVT#<revision>#<eventId>` sorts numerically. `eventId` is a
 * digest of the idempotency key, so a raced exact retry derives the same SK
 * and the "insert only if absent" condition can catch it.
 */
function eventSortKey(revision: number, idempotencyKey: string): string {
  const eventId = createHash('sha256').update(idempotencyKey).digest('hex').slice(0, 32);
  return `${EVENT_SORT_KEY_PREFIX}${String(revision).padStart(10, '0')}#${eventId}`;
}

/**
 * The idempotency item (ADR-0035). It has its own partition because the
 * lookup happens before the caller knows the investigation id.
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

/** Returns `undefined` when `INVESTIGATION_TABLE_NAME` is unset; the caller decides what that means. */
export function readInvestigationTableName(env: NodeJS.ProcessEnv = process.env): string | undefined {
  return env.INVESTIGATION_TABLE_NAME;
}

/**
 * All `EVT#` items, oldest first. Product reads use the `CURRENT` item; this
 * is for the commit path and for checking that the events fold into it.
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
        // Strongly consistent: a stale replica could turn an exact retry into
        // `idempotency-conflict`.
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
      // Strongly consistent for the same reason as `queryEvents`.
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
 * Positions in `transactItems`. `CancellationReasons` is parallel to them,
 * which tells a raced retry apart from a stale revision.
 */
const EVENT_ITEM_INDEX = 0;
const PROJECTION_ITEM_INDEX = 1;
const IDEMPOTENCY_ITEM_INDEX = 2;

/**
 * Appends one event and advances the projection in a single
 * `TransactWriteItems` call (ADR-0035). A new investigation asserts the
 * projection is absent instead of checking `expectedRevision`. A cancelled
 * transaction is inspected per item so a raced idempotency item is not
 * reported as a stale revision.
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
      // Throttling or another unexpected cancellation has no mapped outcome.
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
 * The DynamoDB `InvestigationRepository` used by the AWS deployment
 * (ADR-0035). Every command writes one immutable `EVT#` item and the
 * `CURRENT` projection in one transaction.
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
