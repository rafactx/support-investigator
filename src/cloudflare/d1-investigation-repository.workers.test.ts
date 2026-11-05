import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { foldInvestigationEvents, type InvestigationEvent } from '../domain/investigation.ts';
import {
  contractIntake,
  contractOutcome,
  describeInvestigationRepositoryContract,
} from '../domain/investigation-repository.contract.ts';
import { createD1InvestigationRepository } from './d1-investigation-repository.ts';

/**
 * The shared `InvestigationRepository` contract, against a real local D1
 * database inside workerd (Miniflare), with the committed migrations.
 */
describe('D1InvestigationRepository contract', () => {
  describeInvestigationRepositoryContract(() => createD1InvestigationRepository(env.DB));
});

const review = {
  outcome: 'confirmed' as const,
  reviewerName: 'race-check',
  automatedFindingCode: 'ROOT_CAUSE_UNDETERMINED' as const,
  occurredAt: '2026-07-30T12:05:00.000Z',
};

async function seed(repository = createD1InvestigationRepository(env.DB)) {
  const investigationId = `inv-${crypto.randomUUID()}`;
  await repository.createInvestigation({
    investigationId,
    idempotencyKey: `key-${crypto.randomUUID()}`,
    requestFingerprint: 'fp-create',
    occurredAt: '2026-07-30T12:00:00.000Z',
    intake: contractIntake(),
    state: 'completed',
    outcome: contractOutcome(),
  });
  return { repository, investigationId };
}

describe('D1InvestigationRepository: storage and concurrency', () => {
  it('the stored projection equals an independent fold of the immutable event rows', async () => {
    const { repository, investigationId } = await seed();
    await repository.appendReview({
      investigationId,
      idempotencyKey: `key-${crypto.randomUUID()}`,
      requestFingerprint: 'fp-review',
      expectedRevision: 1,
      occurredAt: review.occurredAt,
      review,
    });

    const { results } = await env.DB.prepare(
      'SELECT revision, event FROM investigation_events WHERE investigation_id = ?1 ORDER BY revision',
    )
      .bind(investigationId)
      .all<{ revision: number; event: string }>();
    const projection = await env.DB.prepare('SELECT investigation FROM investigation_current WHERE investigation_id = ?1')
      .bind(investigationId)
      .first<{ investigation: string }>();

    expect(results.map((row) => row.revision)).toEqual([1, 2]);
    const reconstructed = foldInvestigationEvents(results.map((row) => JSON.parse(row.event) as InvestigationEvent));
    expect(JSON.parse(projection?.investigation ?? 'null')).toEqual(JSON.parse(JSON.stringify(reconstructed)));
  });

  it('two concurrent exact retries race the transaction: one appends, the other replays', async () => {
    const { repository, investigationId } = await seed();
    const idempotencyKey = `key-${crypto.randomUUID()}`;
    const attempt = () =>
      repository.appendReview({
        investigationId,
        idempotencyKey,
        requestFingerprint: 'fp-race',
        expectedRevision: 1,
        occurredAt: review.occurredAt,
        review,
      });

    const kinds = (await Promise.all([attempt(), attempt()])).map((result) => result.kind).sort();

    expect(kinds).toEqual(['appended', 'idempotent-replay']);
    const current = await repository.getCurrentInvestigation(investigationId);
    expect(current?.revision).toBe(2);
    expect(current?.reviews).toHaveLength(1);
  });

  it('two concurrent edits at the same revision: one wins, the other is a stale revision, never a lost update', async () => {
    const { repository, investigationId } = await seed();
    const attempt = (fingerprint: string) =>
      repository.appendReview({
        investigationId,
        idempotencyKey: `key-${crypto.randomUUID()}`,
        requestFingerprint: fingerprint,
        expectedRevision: 1,
        occurredAt: review.occurredAt,
        review,
      });

    const results = await Promise.all([attempt('fp-a'), attempt('fp-b')]);

    expect(results.map((result) => result.kind).sort()).toEqual(['appended', 'stale-revision']);
    expect(results.find((result) => result.kind === 'stale-revision')).toEqual({
      kind: 'stale-revision',
      currentRevision: 2,
    });
    expect((await repository.getCurrentInvestigation(investigationId))?.revision).toBe(2);
  });

  it('an expected revision ahead of history is stale, not a gap in the event sequence', async () => {
    const { repository, investigationId } = await seed();

    const result = await repository.appendReview({
      investigationId,
      idempotencyKey: `key-${crypto.randomUUID()}`,
      requestFingerprint: 'fp-ahead',
      expectedRevision: 5,
      occurredAt: review.occurredAt,
      review,
    });

    expect(result).toEqual({ kind: 'stale-revision', currentRevision: 1 });
  });

  it('a failed command leaves no reserved idempotency key behind (the batch is one transaction)', async () => {
    const { repository, investigationId } = await seed();
    const idempotencyKey = `key-${crypto.randomUUID()}`;
    // Bypass the adapter's pre-checks to force the in-transaction guard.
    await env.DB.prepare('UPDATE investigation_current SET revision = 7 WHERE investigation_id = ?1')
      .bind(investigationId)
      .run();

    await expect(
      env.DB.batch([
        env.DB.prepare(
          'INSERT INTO idempotency_keys (idempotency_key, request_fingerprint, investigation_id) VALUES (?1, ?2, ?3)',
        ).bind(idempotencyKey, 'fp', investigationId),
        env.DB.prepare(
          `INSERT INTO investigation_events (investigation_id, revision, event)
           VALUES (?1, (SELECT revision + 1 FROM investigation_current WHERE investigation_id = ?1 AND revision = ?2), ?3)`,
        ).bind(investigationId, 1, '{}'),
      ]),
    ).rejects.toThrow(/NOT NULL/);
    expect(await repository.findByIdempotencyKey(idempotencyKey, 'fp')).toEqual({ kind: 'not-found' });
  });

  it('persists only typed domain columns: no raw ticket text or credential column exists', async () => {
    const columns = async (table: string) =>
      (await env.DB.prepare(`SELECT name FROM pragma_table_info('${table}')`).all<{ name: string }>()).results
        .map((row) => row.name)
        .sort();

    expect(await columns('investigation_events')).toEqual(['event', 'investigation_id', 'revision']);
    expect(await columns('investigation_current')).toEqual(['investigation', 'investigation_id', 'revision']);
    expect(await columns('idempotency_keys')).toEqual(['idempotency_key', 'investigation_id', 'request_fingerprint']);
  });
});
