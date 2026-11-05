import {
  foldInvestigationEvents,
  type Investigation,
  type InvestigationEvent,
} from '../domain/investigation.ts';
import type { IdempotencyLookup, InvestigationRepository } from '../domain/investigation-repository.ts';
import type { D1DatabaseLike, D1PreparedStatementLike } from './d1.ts';

interface IdempotencyRow {
  readonly request_fingerprint: string;
  readonly investigation_id: string;
}

interface CommandEnvelope {
  readonly investigationId: string;
  readonly idempotencyKey: string;
  readonly requestFingerprint: string;
  readonly expectedRevision: number;
}

type AppendOutcome =
  | { readonly kind: 'applied'; readonly investigation: Investigation }
  | { readonly kind: 'idempotent-replay'; readonly investigation: Investigation }
  | { readonly kind: 'idempotency-conflict' }
  | { readonly kind: 'stale-revision'; readonly currentRevision: number }
  | { readonly kind: 'not-found' };

function fold(events: readonly InvestigationEvent[]): Investigation {
  const investigation = foldInvestigationEvents(events);
  if (!investigation) {
    throw new Error('Unreachable: an investigation event history failed to fold.');
  }
  return investigation;
}

/**
 * `InvestigationRepository` on Cloudflare D1 (ADR-0048), passing the same
 * contract suite as the in-memory and DynamoDB adapters.
 *
 * Each accepted command is one `db.batch()`, which D1 runs as a single SQL
 * transaction: the idempotency key, the immutable event and the refreshed
 * projection commit together or not at all. Optimistic concurrency lives in
 * the SQL itself: the new event's revision is read from the projection
 * *inside* the transaction and only when it still equals the expected
 * revision; otherwise it is `NULL`, the `NOT NULL` constraint aborts the
 * batch, and the adapter re-reads state to report the real cause
 * (an idempotent replay that won the race, a key conflict, or a stale
 * revision). The reads before the batch only avoid doomed writes; they are
 * never the guard.
 */
export function createD1InvestigationRepository(db: D1DatabaseLike): InvestigationRepository {
  async function readEvents(investigationId: string): Promise<InvestigationEvent[]> {
    const { results } = await db
      .prepare('SELECT event FROM investigation_events WHERE investigation_id = ?1 ORDER BY revision')
      .bind(investigationId)
      .all<{ event: string }>();
    return results.map((row) => JSON.parse(row.event) as InvestigationEvent);
  }

  async function readCurrent(investigationId: string): Promise<Investigation | undefined> {
    const row = await db
      .prepare('SELECT investigation FROM investigation_current WHERE investigation_id = ?1')
      .bind(investigationId)
      .first<{ investigation: string }>();
    return row ? (JSON.parse(row.investigation) as Investigation) : undefined;
  }

  async function lookup(idempotencyKey: string, requestFingerprint: string): Promise<IdempotencyLookup> {
    const row = await db
      .prepare('SELECT request_fingerprint, investigation_id FROM idempotency_keys WHERE idempotency_key = ?1')
      .bind(idempotencyKey)
      .first<IdempotencyRow>();
    if (!row) return { kind: 'not-found' };
    if (row.request_fingerprint !== requestFingerprint) return { kind: 'conflict' };
    const investigation = await readCurrent(row.investigation_id);
    return investigation ? { kind: 'found', investigation } : { kind: 'not-found' };
  }

  function reserveKey(idempotencyKey: string, requestFingerprint: string, investigationId: string): D1PreparedStatementLike {
    return db
      .prepare('INSERT INTO idempotency_keys (idempotency_key, request_fingerprint, investigation_id) VALUES (?1, ?2, ?3)')
      .bind(idempotencyKey, requestFingerprint, investigationId);
  }

  async function append(command: CommandEnvelope, event: InvestigationEvent): Promise<AppendOutcome> {
    const events = await readEvents(command.investigationId);
    if (events.length === 0) return { kind: 'not-found' };

    const existing = await lookup(command.idempotencyKey, command.requestFingerprint);
    if (existing.kind === 'conflict') return { kind: 'idempotency-conflict' };
    if (existing.kind === 'found') return { kind: 'idempotent-replay', investigation: existing.investigation };

    if (events.length !== command.expectedRevision) {
      return { kind: 'stale-revision', currentRevision: events.length };
    }

    const investigation = fold([...events, event]);
    try {
      await db.batch([
        reserveKey(command.idempotencyKey, command.requestFingerprint, command.investigationId),
        db
          .prepare(
            `INSERT INTO investigation_events (investigation_id, revision, event)
             VALUES (?1, (SELECT revision + 1 FROM investigation_current WHERE investigation_id = ?1 AND revision = ?2), ?3)`,
          )
          .bind(command.investigationId, command.expectedRevision, JSON.stringify(event)),
        db
          .prepare(
            'UPDATE investigation_current SET revision = ?2 + 1, investigation = ?3 WHERE investigation_id = ?1 AND revision = ?2',
          )
          .bind(command.investigationId, command.expectedRevision, JSON.stringify(investigation)),
      ]);
    } catch (error) {
      // Lost a race. Report why, from committed state, instead of guessing.
      const after = await lookup(command.idempotencyKey, command.requestFingerprint);
      if (after.kind === 'conflict') return { kind: 'idempotency-conflict' };
      if (after.kind === 'found') return { kind: 'idempotent-replay', investigation: after.investigation };
      const current = await readCurrent(command.investigationId);
      if (current && current.revision !== command.expectedRevision) {
        return { kind: 'stale-revision', currentRevision: current.revision };
      }
      throw error;
    }
    return { kind: 'applied', investigation };
  }

  return {
    findByIdempotencyKey: lookup,

    async createInvestigation(command) {
      const existing = await lookup(command.idempotencyKey, command.requestFingerprint);
      if (existing.kind === 'conflict') return { kind: 'idempotency-conflict' };
      if (existing.kind === 'found') return { kind: 'idempotent-replay', investigation: existing.investigation };

      const event: InvestigationEvent = {
        kind: 'investigation_created',
        investigationId: command.investigationId,
        occurredAt: command.occurredAt,
        intake: command.intake,
        state: command.state,
        outcome: command.outcome,
        failureReason: command.failureReason,
      };
      const investigation = fold([event]);
      try {
        await db.batch([
          reserveKey(command.idempotencyKey, command.requestFingerprint, command.investigationId),
          db
            .prepare('INSERT INTO investigation_events (investigation_id, revision, event) VALUES (?1, 1, ?2)')
            .bind(command.investigationId, JSON.stringify(event)),
          db
            .prepare('INSERT INTO investigation_current (investigation_id, revision, investigation) VALUES (?1, 1, ?2)')
            .bind(command.investigationId, JSON.stringify(investigation)),
        ]);
      } catch (error) {
        const after = await lookup(command.idempotencyKey, command.requestFingerprint);
        if (after.kind === 'conflict') return { kind: 'idempotency-conflict' };
        if (after.kind === 'found') return { kind: 'idempotent-replay', investigation: after.investigation };
        throw error;
      }
      return { kind: 'created', investigation };
    },

    async updateIntake(command) {
      const outcome = await append(command, {
        kind: 'intake_updated',
        investigationId: command.investigationId,
        occurredAt: command.occurredAt,
        intake: command.intake,
        state: command.state,
        outcome: command.outcome,
        failureReason: command.failureReason,
      });
      return outcome.kind === 'applied' ? { kind: 'updated', investigation: outcome.investigation } : outcome;
    },

    async requestExplanationImprovement(command) {
      const outcome = await append(command, {
        kind: 'explanation_improvement_requested',
        investigationId: command.investigationId,
        occurredAt: command.occurredAt,
        result: command.result,
      });
      return outcome.kind === 'applied' ? { kind: 'recorded', investigation: outcome.investigation } : outcome;
    },

    async appendReview(command) {
      const outcome = await append(command, {
        kind: 'review_appended',
        investigationId: command.investigationId,
        occurredAt: command.occurredAt,
        review: command.review,
      });
      return outcome.kind === 'applied' ? { kind: 'appended', investigation: outcome.investigation } : outcome;
    },

    getCurrentInvestigation: readCurrent,
  };
}
