import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { InvestigationRepository } from './investigation-repository.ts';
import { buildInvestigationOutcome, confirmedUserIntake } from './investigation.ts';
import { createEvidenceLedger, type LedgerFact } from './finding-policy.ts';

const ENVELOPE = {
  investigationId: 'inv-1',
  capabilityCallId: 'call-1',
  accountScope: { accountId: 'account-17' },
  observedAt: '2026-07-30T12:00:00.000Z',
  schemaVersion: '1' as const,
};

function fact(overrides: Partial<LedgerFact> = {}): LedgerFact {
  return {
    ...ENVELOPE,
    kind: 'inventory',
    capability: 'inventory',
    skuId: 'SKU-2002',
    seller: '1',
    requestedQuantity: 1,
    availableQuantity: 8,
    ...overrides,
  } as LedgerFact;
}

export function contractOutcome() {
  return buildInvestigationOutcome({
    kind: 'observed',
    ledger: createEvidenceLedger({ facts: [fact()] }),
    symptomReproduced: false,
  });
}

export function contractIntake() {
  return confirmedUserIntake({
    accountId: 'account-17',
    skuId: 'SKU-2002',
    seller: '1',
    quantity: 1,
    destinationPostalCode: '01310-100',
  });
}

/**
 * Unique per call so the same contract suite can run against a persistent
 * shared store: a DynamoDB table can't hand each test a
 * wiped world the way a fresh in-memory instance can, so no test may rely
 * on a fixed id like `inv-1` being unclaimed.
 */
function unique(prefix: string): string {
  return `${prefix}-${randomUUID()}`;
}

export type MakeInvestigationRepository = () => Promise<InvestigationRepository> | InvestigationRepository;

/**
 * The one behavioral contract every `InvestigationRepository` adapter must
 * satisfy — registered by the in-memory runner
 * (`investigation-repository.test.ts`), the DynamoDB integration runner
 * (`src/persistence/dynamodb-investigation-repository.contract.test.ts`)
 * and the D1 runner inside workerd
 * (`src/cloudflare/d1-investigation-repository.workers.test.ts`).
 * Assertion bodies are the behavior the API routes proved against the
 * in-memory adapter; an adapter passes by producing the same structured
 * results, never by being the same implementation.
 */
export function describeInvestigationRepositoryContract(makeRepository: MakeInvestigationRepository): void {
  it('creates an investigation and reads it back via getCurrentInvestigation', async () => {
    const repository = await makeRepository();
    const investigationId = unique('inv');

    const created = await repository.createInvestigation({
      investigationId,
      idempotencyKey: unique('key'),
      requestFingerprint: 'fp-1',
      occurredAt: '2026-07-30T12:00:00.000Z',
      intake: contractIntake(),
      state: 'completed',
      outcome: contractOutcome(),
    });

    expect(created.kind).toBe('created');
    const fetched = await repository.getCurrentInvestigation(investigationId);
    expect(fetched?.id).toBe(investigationId);
    expect(fetched?.revision).toBe(1);
    expect(fetched?.state).toBe('completed');
  });

  it('returns undefined for an unknown investigation id', async () => {
    const repository = await makeRepository();
    expect(await repository.getCurrentInvestigation(unique('does-not-exist'))).toBeUndefined();
  });

  it('findByIdempotencyKey reports not-found before any create (AC5 pre-check seam)', async () => {
    const repository = await makeRepository();
    expect(await repository.findByIdempotencyKey(unique('key'), 'fp-1')).toEqual({ kind: 'not-found' });
  });

  it('an exact retry (same key, same fingerprint) is visible via findByIdempotencyKey without a second create', async () => {
    const repository = await makeRepository();
    const investigationId = unique('inv');
    const idempotencyKey = unique('key');
    await repository.createInvestigation({
      investigationId,
      idempotencyKey,
      requestFingerprint: 'fp-1',
      occurredAt: '2026-07-30T12:00:00.000Z',
      intake: contractIntake(),
      state: 'completed',
      outcome: contractOutcome(),
    });

    const lookup = await repository.findByIdempotencyKey(idempotencyKey, 'fp-1');
    expect(lookup.kind).toBe('found');
    expect(lookup.kind === 'found' && lookup.investigation.id).toBe(investigationId);

    // createInvestigation itself is also idempotent (the atomic commit path,
    // not just the pre-check) — replaying it never appends a second event.
    const replay = await repository.createInvestigation({
      investigationId,
      idempotencyKey,
      requestFingerprint: 'fp-1',
      occurredAt: '2026-07-30T12:05:00.000Z',
      intake: contractIntake(),
      state: 'completed',
      outcome: contractOutcome(),
    });
    expect(replay.kind).toBe('idempotent-replay');
    expect(replay.kind === 'idempotent-replay' && replay.investigation.id).toBe(investigationId);
    expect((await repository.getCurrentInvestigation(investigationId))?.revision).toBe(1);
  });

  it('reusing a key with a different payload is a structured conflict, not a silent overwrite (AC5)', async () => {
    const repository = await makeRepository();
    const investigationId = unique('inv');
    const otherInvestigationId = unique('inv');
    const idempotencyKey = unique('key');
    await repository.createInvestigation({
      investigationId,
      idempotencyKey,
      requestFingerprint: 'fp-1',
      occurredAt: '2026-07-30T12:00:00.000Z',
      intake: contractIntake(),
      state: 'completed',
      outcome: contractOutcome(),
    });

    expect(await repository.findByIdempotencyKey(idempotencyKey, 'fp-2')).toEqual({ kind: 'conflict' });

    const conflicting = await repository.createInvestigation({
      investigationId: otherInvestigationId,
      idempotencyKey,
      requestFingerprint: 'fp-2',
      occurredAt: '2026-07-30T12:00:00.000Z',
      intake: contractIntake(),
      state: 'completed',
      outcome: contractOutcome(),
    });
    expect(conflicting.kind).toBe('idempotency-conflict');
    // The conflicting attempt never created the second investigation.
    expect(await repository.getCurrentInvestigation(otherInvestigationId)).toBeUndefined();
  });

  it('a different idempotency key with the same payload creates a distinct investigation', async () => {
    const repository = await makeRepository();
    const first = await repository.createInvestigation({
      investigationId: unique('inv'),
      idempotencyKey: unique('key'),
      requestFingerprint: 'fp-1',
      occurredAt: '2026-07-30T12:00:00.000Z',
      intake: contractIntake(),
      state: 'completed',
      outcome: contractOutcome(),
    });
    const second = await repository.createInvestigation({
      investigationId: unique('inv'),
      idempotencyKey: unique('key'),
      requestFingerprint: 'fp-1',
      occurredAt: '2026-07-30T12:00:01.000Z',
      intake: contractIntake(),
      state: 'completed',
      outcome: contractOutcome(),
    });

    expect(first.kind).toBe('created');
    expect(second.kind).toBe('created');
    expect(first.kind === 'created' && first.investigation.id).not.toBe(
      second.kind === 'created' && second.investigation.id,
    );
  });

  describe('updateIntake', () => {
    async function seed() {
      const repository = await makeRepository();
      const investigationId = unique('inv');
      await repository.createInvestigation({
        investigationId,
        idempotencyKey: unique('create-key'),
        requestFingerprint: 'create-fp',
        occurredAt: '2026-07-30T12:00:00.000Z',
        intake: { ...contractIntake(), seller: undefined },
        state: 'awaiting_input',
      });
      return { repository, investigationId };
    }

    it('returns not-found for an investigation that does not exist', async () => {
      const repository = await makeRepository();
      const result = await repository.updateIntake({
        investigationId: unique('does-not-exist'),
        idempotencyKey: unique('patch-key'),
        requestFingerprint: 'patch-fp',
        expectedRevision: 0,
        occurredAt: '2026-07-30T12:05:00.000Z',
        intake: contractIntake(),
        state: 'completed',
        outcome: contractOutcome(),
      });
      expect(result).toEqual({ kind: 'not-found' });
    });

    it('appends a second event and resumes the investigation when the merged intake is complete', async () => {
      const { repository, investigationId } = await seed();
      const result = await repository.updateIntake({
        investigationId,
        idempotencyKey: unique('patch-key'),
        requestFingerprint: 'patch-fp',
        expectedRevision: 1,
        occurredAt: '2026-07-30T12:05:00.000Z',
        intake: contractIntake(),
        state: 'completed',
        outcome: contractOutcome(),
      });

      expect(result.kind).toBe('updated');
      expect(result.kind === 'updated' && result.investigation.state).toBe('completed');
      expect(result.kind === 'updated' && result.investigation.revision).toBe(2);

      const fetched = await repository.getCurrentInvestigation(investigationId);
      expect(fetched?.state).toBe('completed');
      expect(fetched?.revision).toBe(2);
    });

    it('a stale expectedRevision is a structured conflict, not a silent overwrite', async () => {
      const { repository, investigationId } = await seed();
      const result = await repository.updateIntake({
        investigationId,
        idempotencyKey: unique('patch-key'),
        requestFingerprint: 'patch-fp',
        expectedRevision: 0, // stale: the seeded investigation is already at revision 1
        occurredAt: '2026-07-30T12:05:00.000Z',
        intake: contractIntake(),
        state: 'completed',
        outcome: contractOutcome(),
      });
      expect(result).toEqual({ kind: 'stale-revision', currentRevision: 1 });
      // The stale attempt never touched history.
      expect((await repository.getCurrentInvestigation(investigationId))?.revision).toBe(1);
    });

    it('an exact retry (same key, same fingerprint) returns the applied representation without a second append', async () => {
      const { repository, investigationId } = await seed();
      const idempotencyKey = unique('patch-key');
      const first = await repository.updateIntake({
        investigationId,
        idempotencyKey,
        requestFingerprint: 'patch-fp',
        expectedRevision: 1,
        occurredAt: '2026-07-30T12:05:00.000Z',
        intake: contractIntake(),
        state: 'completed',
        outcome: contractOutcome(),
      });
      expect(first.kind).toBe('updated');

      const retry = await repository.updateIntake({
        investigationId,
        idempotencyKey,
        requestFingerprint: 'patch-fp',
        expectedRevision: 1,
        occurredAt: '2026-07-30T12:10:00.000Z',
        intake: contractIntake(),
        state: 'completed',
        outcome: contractOutcome(),
      });
      expect(retry.kind).toBe('idempotent-replay');
      expect((await repository.getCurrentInvestigation(investigationId))?.revision).toBe(2);
    });

    it('reusing a key with a different payload is a structured conflict', async () => {
      const { repository, investigationId } = await seed();
      const idempotencyKey = unique('patch-key');
      await repository.updateIntake({
        investigationId,
        idempotencyKey,
        requestFingerprint: 'patch-fp',
        expectedRevision: 1,
        occurredAt: '2026-07-30T12:05:00.000Z',
        intake: contractIntake(),
        state: 'completed',
        outcome: contractOutcome(),
      });

      const conflicting = await repository.updateIntake({
        investigationId,
        idempotencyKey,
        requestFingerprint: 'different-fp',
        expectedRevision: 2,
        occurredAt: '2026-07-30T12:10:00.000Z',
        intake: contractIntake(),
        state: 'completed',
        outcome: contractOutcome(),
      });
      expect(conflicting).toEqual({ kind: 'idempotency-conflict' });
      expect((await repository.getCurrentInvestigation(investigationId))?.revision).toBe(2);
    });
  });

  describe('requestExplanationImprovement', () => {
    const acceptedResult = {
      status: 'accepted' as const,
      improvedExplanation: {
        summary: 'Improved wording.',
        sourcePackVersion: '1' as const,
        sources: [],
        generatedAt: '2026-07-30T12:05:00.000Z',
      },
    };

    async function seedCompleted() {
      const repository = await makeRepository();
      const investigationId = unique('inv');
      await repository.createInvestigation({
        investigationId,
        idempotencyKey: unique('create-key'),
        requestFingerprint: 'create-fp',
        occurredAt: '2026-07-30T12:00:00.000Z',
        intake: contractIntake(),
        state: 'completed',
        outcome: contractOutcome(),
      });
      return { repository, investigationId };
    }

    it('returns not-found for an investigation that does not exist', async () => {
      const repository = await makeRepository();
      const result = await repository.requestExplanationImprovement({
        investigationId: unique('does-not-exist'),
        idempotencyKey: unique('expl-key'),
        requestFingerprint: 'expl-fp',
        expectedRevision: 1,
        occurredAt: '2026-07-30T12:05:00.000Z',
        result: acceptedResult,
      });
      expect(result).toEqual({ kind: 'not-found' });
    });

    it('appends an event attaching the result to the existing outcome, revision incremented by one', async () => {
      const { repository, investigationId } = await seedCompleted();
      const result = await repository.requestExplanationImprovement({
        investigationId,
        idempotencyKey: unique('expl-key'),
        requestFingerprint: 'expl-fp',
        expectedRevision: 1,
        occurredAt: '2026-07-30T12:05:00.000Z',
        result: acceptedResult,
      });

      expect(result.kind).toBe('recorded');
      expect(result.kind === 'recorded' && result.investigation.revision).toBe(2);
      expect(result.kind === 'recorded' && result.investigation.outcome?.explanationImprovement).toEqual(
        acceptedResult,
      );

      const fetched = await repository.getCurrentInvestigation(investigationId);
      expect(fetched?.revision).toBe(2);
      expect(fetched?.outcome?.explanationImprovement).toEqual(acceptedResult);
    });

    it('a stale expectedRevision is a structured conflict, not a silent overwrite', async () => {
      const { repository, investigationId } = await seedCompleted();
      const result = await repository.requestExplanationImprovement({
        investigationId,
        idempotencyKey: unique('expl-key'),
        requestFingerprint: 'expl-fp',
        expectedRevision: 0, // stale: the seeded investigation is already at revision 1
        occurredAt: '2026-07-30T12:05:00.000Z',
        result: acceptedResult,
      });
      expect(result).toEqual({ kind: 'stale-revision', currentRevision: 1 });
      expect((await repository.getCurrentInvestigation(investigationId))?.revision).toBe(1);
    });

    it('an exact retry (same key, same fingerprint) returns the applied representation without a second append', async () => {
      const { repository, investigationId } = await seedCompleted();
      const idempotencyKey = unique('expl-key');
      const first = await repository.requestExplanationImprovement({
        investigationId,
        idempotencyKey,
        requestFingerprint: 'expl-fp',
        expectedRevision: 1,
        occurredAt: '2026-07-30T12:05:00.000Z',
        result: acceptedResult,
      });
      expect(first.kind).toBe('recorded');

      const retry = await repository.requestExplanationImprovement({
        investigationId,
        idempotencyKey,
        requestFingerprint: 'expl-fp',
        expectedRevision: 1,
        occurredAt: '2026-07-30T12:10:00.000Z',
        result: acceptedResult,
      });
      expect(retry.kind).toBe('idempotent-replay');
      expect((await repository.getCurrentInvestigation(investigationId))?.revision).toBe(2);
    });

    it('reusing a key with a different payload is a structured conflict', async () => {
      const { repository, investigationId } = await seedCompleted();
      const idempotencyKey = unique('expl-key');
      await repository.requestExplanationImprovement({
        investigationId,
        idempotencyKey,
        requestFingerprint: 'expl-fp',
        expectedRevision: 1,
        occurredAt: '2026-07-30T12:05:00.000Z',
        result: acceptedResult,
      });

      const conflicting = await repository.requestExplanationImprovement({
        investigationId,
        idempotencyKey,
        requestFingerprint: 'different-fp',
        expectedRevision: 2,
        occurredAt: '2026-07-30T12:10:00.000Z',
        result: { status: 'rejected', reason: 'unrelated attempt' },
      });
      expect(conflicting).toEqual({ kind: 'idempotency-conflict' });
      expect((await repository.getCurrentInvestigation(investigationId))?.revision).toBe(2);
    });

    it('records a rejected result without inventing an improvedExplanation', async () => {
      const { repository, investigationId } = await seedCompleted();
      const result = await repository.requestExplanationImprovement({
        investigationId,
        idempotencyKey: unique('expl-key'),
        requestFingerprint: 'expl-fp',
        expectedRevision: 1,
        occurredAt: '2026-07-30T12:05:00.000Z',
        result: { status: 'rejected', reason: 'Cited an off-pack URL.' },
      });

      expect(result.kind).toBe('recorded');
      expect(result.kind === 'recorded' && result.investigation.outcome?.explanationImprovement).toEqual({
        status: 'rejected',
        reason: 'Cited an off-pack URL.',
      });
    });
  });

  describe('appendReview', () => {
    const confirmedReview = {
      outcome: 'confirmed' as const,
      reviewerName: 'ana',
      automatedFindingCode: 'ROOT_CAUSE_UNDETERMINED' as const,
      occurredAt: '2026-07-30T12:05:00.000Z',
    };

    async function seedCompleted() {
      const repository = await makeRepository();
      const investigationId = unique('inv');
      await repository.createInvestigation({
        investigationId,
        idempotencyKey: unique('create-key'),
        requestFingerprint: 'create-fp',
        occurredAt: '2026-07-30T12:00:00.000Z',
        intake: contractIntake(),
        state: 'completed',
        outcome: contractOutcome(),
      });
      return { repository, investigationId };
    }

    it('returns not-found for an investigation that does not exist', async () => {
      const repository = await makeRepository();
      const result = await repository.appendReview({
        investigationId: unique('does-not-exist'),
        idempotencyKey: unique('review-key'),
        requestFingerprint: 'review-fp',
        expectedRevision: 1,
        occurredAt: '2026-07-30T12:05:00.000Z',
        review: confirmedReview,
      });
      expect(result).toEqual({ kind: 'not-found' });
    });

    it('appends an event, revision incremented by one, without touching the automated outcome (AC3)', async () => {
      const { repository, investigationId } = await seedCompleted();
      const before = await repository.getCurrentInvestigation(investigationId);

      const result = await repository.appendReview({
        investigationId,
        idempotencyKey: unique('review-key'),
        requestFingerprint: 'review-fp',
        expectedRevision: 1,
        occurredAt: '2026-07-30T12:05:00.000Z',
        review: confirmedReview,
      });

      expect(result.kind).toBe('appended');
      expect(result.kind === 'appended' && result.investigation.revision).toBe(2);
      expect(result.kind === 'appended' && result.investigation.reviews).toEqual([confirmedReview]);
      expect(result.kind === 'appended' && result.investigation.outcome).toEqual(before?.outcome);

      const fetched = await repository.getCurrentInvestigation(investigationId);
      expect(fetched?.revision).toBe(2);
      expect(fetched?.reviews).toEqual([confirmedReview]);
    });

    it('a second review appends rather than replaces the first (AC3: previous reviews remain immutable and visible)', async () => {
      const { repository, investigationId } = await seedCompleted();
      await repository.appendReview({
        investigationId,
        idempotencyKey: unique('review-key'),
        requestFingerprint: 'review-fp-1',
        expectedRevision: 1,
        occurredAt: '2026-07-30T12:05:00.000Z',
        review: confirmedReview,
      });

      const correctedReview = {
        outcome: 'corrected' as const,
        reviewerName: 'bruno',
        automatedFindingCode: 'ROOT_CAUSE_UNDETERMINED' as const,
        correctedFindingCode: 'DESTINATION_NOT_COVERED' as const,
        reason: 'conflicting_evidence' as const,
        occurredAt: '2026-07-30T12:10:00.000Z',
      };
      const second = await repository.appendReview({
        investigationId,
        idempotencyKey: unique('review-key'),
        requestFingerprint: 'review-fp-2',
        expectedRevision: 2,
        occurredAt: '2026-07-30T12:10:00.000Z',
        review: correctedReview,
      });

      expect(second.kind).toBe('appended');
      expect(second.kind === 'appended' && second.investigation.reviews).toEqual([confirmedReview, correctedReview]);
      expect((await repository.getCurrentInvestigation(investigationId))?.revision).toBe(3);
    });

    it('a stale expectedRevision is a structured conflict, not a silent overwrite', async () => {
      const { repository, investigationId } = await seedCompleted();
      const result = await repository.appendReview({
        investigationId,
        idempotencyKey: unique('review-key'),
        requestFingerprint: 'review-fp',
        expectedRevision: 0, // stale: the seeded investigation is already at revision 1
        occurredAt: '2026-07-30T12:05:00.000Z',
        review: confirmedReview,
      });
      expect(result).toEqual({ kind: 'stale-revision', currentRevision: 1 });
      expect((await repository.getCurrentInvestigation(investigationId))?.revision).toBe(1);
      expect((await repository.getCurrentInvestigation(investigationId))?.reviews).toEqual([]);
    });

    it('an exact retry (same key, same fingerprint) returns the applied representation without a second append', async () => {
      const { repository, investigationId } = await seedCompleted();
      const idempotencyKey = unique('review-key');
      const first = await repository.appendReview({
        investigationId,
        idempotencyKey,
        requestFingerprint: 'review-fp',
        expectedRevision: 1,
        occurredAt: '2026-07-30T12:05:00.000Z',
        review: confirmedReview,
      });
      expect(first.kind).toBe('appended');

      const retry = await repository.appendReview({
        investigationId,
        idempotencyKey,
        requestFingerprint: 'review-fp',
        expectedRevision: 1,
        occurredAt: '2026-07-30T12:10:00.000Z',
        review: confirmedReview,
      });
      expect(retry.kind).toBe('idempotent-replay');
      expect((await repository.getCurrentInvestigation(investigationId))?.revision).toBe(2);
      expect((await repository.getCurrentInvestigation(investigationId))?.reviews).toEqual([confirmedReview]);
    });

    it('reusing a key with a different payload is a structured conflict', async () => {
      const { repository, investigationId } = await seedCompleted();
      const idempotencyKey = unique('review-key');
      await repository.appendReview({
        investigationId,
        idempotencyKey,
        requestFingerprint: 'review-fp',
        expectedRevision: 1,
        occurredAt: '2026-07-30T12:05:00.000Z',
        review: confirmedReview,
      });

      const conflicting = await repository.appendReview({
        investigationId,
        idempotencyKey,
        requestFingerprint: 'different-fp',
        expectedRevision: 2,
        occurredAt: '2026-07-30T12:10:00.000Z',
        review: { ...confirmedReview, reviewerName: 'someone-else' },
      });
      expect(conflicting).toEqual({ kind: 'idempotency-conflict' });
      expect((await repository.getCurrentInvestigation(investigationId))?.revision).toBe(2);
    });

    it('reusing the same Idempotency-Key across two different investigations is a structured conflict, not the wrong investigation replayed', async () => {
      const { repository, investigationId } = await seedCompleted();
      const secondInvestigationId = unique('inv');
      const sharedKey = unique('shared-key');
      await repository.createInvestigation({
        investigationId: secondInvestigationId,
        idempotencyKey: unique('create-key'),
        requestFingerprint: 'create-fp-2',
        occurredAt: '2026-07-30T12:00:00.000Z',
        intake: contractIntake(),
        state: 'completed',
        outcome: contractOutcome(),
      });

      await repository.appendReview({
        investigationId,
        idempotencyKey: sharedKey,
        requestFingerprint: 'review-fp-inv-1',
        expectedRevision: 1,
        occurredAt: '2026-07-30T12:05:00.000Z',
        review: confirmedReview,
      });

      const crossInvestigation = await repository.appendReview({
        investigationId: secondInvestigationId,
        idempotencyKey: sharedKey,
        requestFingerprint: 'review-fp-inv-2',
        expectedRevision: 1,
        occurredAt: '2026-07-30T12:05:00.000Z',
        review: confirmedReview,
      });
      expect(crossInvestigation).toEqual({ kind: 'idempotency-conflict' });
      expect((await repository.getCurrentInvestigation(secondInvestigationId))?.reviews).toEqual([]);
    });
  });
}
