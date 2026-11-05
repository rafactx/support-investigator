import { decideFixedWindow, type RateLimiter, windowStart } from '../security/rate-limiter.ts';
import type { D1DatabaseLike } from './d1.ts';

/**
 * A fixed-window `RateLimiter` on D1 (ADR-0048). One upsert both counts the
 * request and returns the new count, so concurrent requests cannot read the
 * same value and both slip through: D1 serializes writes to a database.
 * Every Worker isolate in every location shares the same counter, which is
 * why the global daily model budget lives here rather than in the Workers
 * Rate Limiting binding (per location, eventually consistent).
 *
 * Expired windows are pruned when a new window starts, so the table holds
 * roughly one row per active bucket.
 */
export function createD1RateLimiter(db: D1DatabaseLike): RateLimiter {
  return {
    async hit(rule, subject, now = new Date()) {
      const start = windowStart(now, rule.windowMs);
      const expiresAt = start.getTime() + rule.windowMs;
      const row = await db
        .prepare(
          `INSERT INTO rate_limit_windows (bucket, window_start, hits, expires_at) VALUES (?1, ?2, 1, ?3)
           ON CONFLICT (bucket, window_start) DO UPDATE SET hits = hits + 1
           RETURNING hits`,
        )
        .bind(`${rule.name}:${subject}`, start.getTime(), expiresAt)
        .first<{ hits: number }>();
      const hits = row?.hits ?? Number.POSITIVE_INFINITY;
      if (hits === 1) {
        await db.prepare('DELETE FROM rate_limit_windows WHERE expires_at <= ?1').bind(now.getTime()).run();
      }
      return decideFixedWindow(rule, hits, start);
    },
  };
}
