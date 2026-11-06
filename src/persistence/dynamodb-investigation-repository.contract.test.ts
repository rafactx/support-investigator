import { randomUUID } from 'node:crypto';
import { DynamoDBClient, DescribeTableCommand } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { describe, expect, it } from 'vitest';
import {
  createDynamoDbInvestigationRepository,
  readInvestigationTableName,
} from './dynamodb-investigation-repository.ts';
import { foldInvestigationEvents, type InvestigationEvent } from '../domain/investigation.ts';
import {
  contractIntake,
  contractOutcome,
  describeInvestigationRepositoryContract,
} from '../domain/investigation-repository.contract.ts';

/**
 * `INVESTIGATION_TABLE_NAME` (plus standard AWS credential env vars/profile)
 * points this suite at a real DynamoDB table — a scratch on-demand table
 * with the ADR-0035 key schema (`PK`/`SK`, both strings), never the
 * deployed stack's own table. Undefined in CI and local runs by default, so
 * `pnpm test` stays deterministic and credential-free.
 *
 * Requirement: "Integration checks requiring unavailable credentials
 * report `skipped` rather than `passed`" — this is stricter than gating on
 * `INVESTIGATION_TABLE_NAME` alone: a table name can be set while AWS
 * credentials are absent or expired (a stale `.env`, a CI runner with no
 * AWS role), which would otherwise make the suite error rather than skip.
 * `probeInvestigationTable` resolves both conditions — env var present,
 * *and* a real `DescribeTableCommand` against it succeeds — into one
 * boolean at module load time (a top-level `await`, which this project's
 * `"type": "module"` + Vitest's ESM support both allow), so
 * `describe.skipIf` below has a single synchronous gate covering "missing
 * config" and "unavailable credentials" alike.
 */
async function probeInvestigationTable(tableName: string | undefined): Promise<boolean> {
  if (!tableName) {
    return false;
  }
  try {
    await new DynamoDBClient({}).send(new DescribeTableCommand({ TableName: tableName }));
    return true;
  } catch {
    return false;
  }
}

const configuredTableName = readInvestigationTableName();
const tableReachable = await probeInvestigationTable(configuredTableName);
// Resolved lazily, from inside a closure `describe.skipIf`'s own `it`s call
// only when NOT skipped — never read directly in a `describe` body.
// `describe.skipIf`'s callback body always runs at collection time even
// when it will skip every `it` inside; a skipped `it` just never invokes
// the closures it was given. Calling this at the `describe`/`it` top level
// instead of inside those closures would throw "Unreachable" on every run
// where the table is unset — including the very runs this suite exists to
// skip cleanly.
function resolvedTableName(): string {
  if (!configuredTableName) {
    throw new Error('Unreachable: tableReachable is only true when configuredTableName is set.');
  }
  return configuredTableName;
}

describe.skipIf(!tableReachable)('DynamoDbInvestigationRepository contract: integration', () => {
  describeInvestigationRepositoryContract(() =>
    createDynamoDbInvestigationRepository({
      tableName: resolvedTableName(),
      client: new DynamoDBClient({}),
    }),
  );
});

/**
 * Assertions the shared contract can't express because they inspect the
 * table directly rather than going through the `InvestigationRepository`
 * port.
 */
describe.skipIf(!tableReachable)('DynamoDbInvestigationRepository: table shape', () => {
  const doc = DynamoDBDocumentClient.from(new DynamoDBClient({}));

  /**
   * The only field names any Investigation item is allowed to carry ("no
   * raw ticket text, credentials or raw provider payloads are
   * written to DynamoDB"). `event`/`investigation` hold typed domain
   * objects only — `InvestigationEvent`'s own union has no free-text or
   * credential-shaped field — but this test pins the item's own top-level
   * shape so a future field added directly to an item (bypassing the
   * typed domain event) would fail loudly here instead of silently
   * persisting something unapproved.
   */
  const ALLOWED_TOP_LEVEL_KEYS = new Set([
    'PK',
    'SK',
    'investigationId',
    'revision',
    'event',
    'investigation',
    'requestFingerprint',
  ]);

  it('the CURRENT projection matches an investigation independently reconstructed by folding its immutable EVT# items', async () => {
    const table = resolvedTableName();
    const repository = createDynamoDbInvestigationRepository({ tableName: table, client: new DynamoDBClient({}) });
    const investigationId = `inv-${randomUUID()}`;

    await repository.createInvestigation({
      investigationId,
      idempotencyKey: `key-${randomUUID()}`,
      requestFingerprint: 'fp-shape-1',
      occurredAt: '2026-07-30T12:00:00.000Z',
      intake: contractIntake(),
      state: 'completed',
      outcome: contractOutcome(),
    });
    await repository.appendReview({
      investigationId,
      idempotencyKey: `key-${randomUUID()}`,
      requestFingerprint: 'fp-shape-2',
      expectedRevision: 1,
      occurredAt: '2026-07-30T12:05:00.000Z',
      review: {
        outcome: 'confirmed',
        reviewerName: 'shape-check',
        automatedFindingCode: 'ROOT_CAUSE_UNDETERMINED',
        occurredAt: '2026-07-30T12:05:00.000Z',
      },
    });

    // The materialized projection, read directly off the CURRENT item —
    // never through `getCurrentInvestigation` (which itself reads this
    // same item), so this assertion doesn't compare an item to itself.
    const projectionResult = await doc.send(
      new QueryCommand({
        TableName: table,
        KeyConditionExpression: 'PK = :pk AND SK = :sk',
        ExpressionAttributeValues: { ':pk': `INV#${investigationId}`, ':sk': 'CURRENT' },
      }),
    );
    const projection = projectionResult.Items?.[0]?.investigation;

    // Independently reconstructed: query the raw EVT# items ourselves and
    // fold them with the same pure function the adapter uses internally —
    // a genuinely separate code path from whatever wrote the CURRENT item.
    const eventsResult = await doc.send(
      new QueryCommand({
        TableName: table,
        KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
        ExpressionAttributeValues: { ':pk': `INV#${investigationId}`, ':prefix': 'EVT#' },
      }),
    );
    const events = (eventsResult.Items ?? []).map((item) => item.event as InvestigationEvent);
    const reconstructed = foldInvestigationEvents(events);

    expect(events).toHaveLength(2);
    expect(projection).toEqual(reconstructed);
    expect(projection?.revision).toBe(2);
    expect(projection?.reviews).toHaveLength(1);
  });

  it('every persisted item exposes only the allowed top-level fields — no raw ticket text or credential fields', async () => {
    const table = resolvedTableName();
    const repository = createDynamoDbInvestigationRepository({ tableName: table, client: new DynamoDBClient({}) });
    const investigationId = `inv-${randomUUID()}`;

    await repository.createInvestigation({
      investigationId,
      idempotencyKey: `key-${randomUUID()}`,
      requestFingerprint: 'fp-shape-3',
      occurredAt: '2026-07-30T12:00:00.000Z',
      intake: contractIntake(),
      state: 'completed',
      outcome: contractOutcome(),
    });

    const items = await doc.send(
      new QueryCommand({
        TableName: table,
        KeyConditionExpression: 'PK = :pk',
        ExpressionAttributeValues: { ':pk': `INV#${investigationId}` },
      }),
    );

    expect(items.Items?.length).toBeGreaterThan(0);
    for (const item of items.Items ?? []) {
      for (const key of Object.keys(item)) {
        expect(ALLOWED_TOP_LEVEL_KEYS.has(key), `unexpected top-level key "${key}" on item ${JSON.stringify(item.SK)}`).toBe(
          true,
        );
      }
    }
  });

  /**
   * Forces the exact race `commitEvent` is written to survive:
   * two concurrent exact retries — same idempotency key, same fingerprint
   * — both reach `TransactWriteCommand` before either commits.
   * DynamoDB's own transaction isolation guarantees only one wins; the
   * loser must land on `idempotent-replay`, never on a fabricated
   * `stale-revision` masking the real cause. `Promise.all` (not sequential
   * awaits) is what actually produces the race — a sequential pair would
   * only ever exercise the already-committed `findByIdempotencyKey`
   * pre-check, never `commitEvent`'s `CancellationReasons` branch.
   */
  it('two concurrent exact retries race the transaction and both resolve to the same investigation', async () => {
    const table = resolvedTableName();
    const repository = createDynamoDbInvestigationRepository({ tableName: table, client: new DynamoDBClient({}) });
    const investigationId = `inv-${randomUUID()}`;
    const idempotencyKey = `key-${randomUUID()}`;

    await repository.createInvestigation({
      investigationId,
      idempotencyKey: `key-${randomUUID()}`,
      requestFingerprint: 'fp-race-create',
      occurredAt: '2026-07-30T12:00:00.000Z',
      intake: contractIntake(),
      state: 'completed',
      outcome: contractOutcome(),
    });

    const raceCommand = () =>
      repository.appendReview({
        investigationId,
        idempotencyKey,
        requestFingerprint: 'fp-race-review',
        expectedRevision: 1,
        occurredAt: '2026-07-30T12:05:00.000Z',
        review: {
          outcome: 'confirmed',
          reviewerName: 'race-check',
          automatedFindingCode: 'ROOT_CAUSE_UNDETERMINED',
          occurredAt: '2026-07-30T12:05:00.000Z',
        },
      });

    const [first, second] = await Promise.all([raceCommand(), raceCommand()]);

    // Whichever attempt wins the transaction is 'appended'; the loser must
    // recover to 'idempotent-replay' — never 'stale-revision' or a thrown
    // error, either of which would mean CancellationReasons parsing failed
    // to distinguish "another attempt with the same key won" from a
    // genuine concurrent-edit conflict.
    const kinds = [first.kind, second.kind].sort();
    expect(kinds).toEqual(['appended', 'idempotent-replay']);

    const finalInvestigation = await repository.getCurrentInvestigation(investigationId);
    expect(finalInvestigation?.revision).toBe(2);
    expect(finalInvestigation?.reviews).toHaveLength(1);
  });
});
