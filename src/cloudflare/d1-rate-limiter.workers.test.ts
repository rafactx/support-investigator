import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { createD1RateLimiter } from './d1-rate-limiter.ts';

const DAY_MS = 24 * 60 * 60 * 1000;

function rule(limit: number, windowMs = DAY_MS) {
  return { name: `model-global-${crypto.randomUUID()}`, limit, windowMs };
}

describe('D1 fixed-window rate limiter', () => {
  it('allows exactly `limit` hits in a window, then denies with a reset at the window end', async () => {
    const limiter = createD1RateLimiter(env.DB);
    const budget = rule(2);
    const now = new Date('2026-11-05T10:00:00.000Z');

    const decisions = [];
    for (let i = 0; i < 3; i++) decisions.push(await limiter.hit(budget, 'all', now));

    expect(decisions.map((decision) => decision.allowed)).toEqual([true, true, false]);
    expect(decisions.map((decision) => decision.remaining)).toEqual([1, 0, 0]);
    expect(decisions[2]?.resetAt.toISOString()).toBe('2026-11-06T00:00:00.000Z');
  });

  it('starts a fresh count in the next window', async () => {
    const limiter = createD1RateLimiter(env.DB);
    const budget = rule(1);

    expect((await limiter.hit(budget, 'all', new Date('2026-11-05T23:59:59.000Z'))).allowed).toBe(true);
    expect((await limiter.hit(budget, 'all', new Date('2026-11-05T23:59:59.500Z'))).allowed).toBe(false);
    expect((await limiter.hit(budget, 'all', new Date('2026-11-06T00:00:00.000Z'))).allowed).toBe(true);
  });

  it('keeps subjects apart', async () => {
    const limiter = createD1RateLimiter(env.DB);
    const perClient = rule(1, 60_000);
    const now = new Date('2026-11-05T10:00:00.000Z');

    expect((await limiter.hit(perClient, 'client-a', now)).allowed).toBe(true);
    expect((await limiter.hit(perClient, 'client-b', now)).allowed).toBe(true);
    expect((await limiter.hit(perClient, 'client-a', now)).allowed).toBe(false);
  });

  it('a concurrent burst cannot exceed the limit: the upsert counts and decides in one statement', async () => {
    const limiter = createD1RateLimiter(env.DB);
    const budget = rule(5);
    const now = new Date('2026-11-05T10:00:00.000Z');

    const decisions = await Promise.all(Array.from({ length: 20 }, () => limiter.hit(budget, 'all', now)));

    expect(decisions.filter((decision) => decision.allowed)).toHaveLength(5);
  });

  it('prunes expired windows when a new window starts', async () => {
    const limiter = createD1RateLimiter(env.DB);
    const perMinute = rule(10, 60_000);

    await limiter.hit(perMinute, 'x', new Date('2026-11-05T10:00:00.000Z'));
    await limiter.hit(perMinute, 'x', new Date('2026-11-05T10:05:00.000Z'));

    const { results } = await env.DB.prepare('SELECT window_start FROM rate_limit_windows WHERE bucket = ?1')
      .bind(`${perMinute.name}:x`)
      .all<{ window_start: number }>();
    expect(results.map((row) => row.window_start)).toEqual([Date.parse('2026-11-05T10:05:00.000Z')]);
  });
});
