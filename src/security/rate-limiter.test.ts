import { describe, expect, it } from 'vitest';
import { createInMemoryRateLimiter, type RateLimitRule } from './rate-limiter.ts';

const RULE: RateLimitRule = { name: 'create', limit: 3, windowMs: 60_000 };
const T0 = new Date('2026-11-05T12:00:10.000Z');

describe('in-memory fixed-window rate limiter', () => {
  it('allows exactly `limit` hits per window, then denies with the window end as resetAt', async () => {
    const limiter = createInMemoryRateLimiter();
    const decisions = [];
    for (let i = 0; i < 4; i++) decisions.push(await limiter.hit(RULE, 'client-a', T0));

    expect(decisions.map((d) => d.allowed)).toEqual([true, true, true, false]);
    expect(decisions.map((d) => d.remaining)).toEqual([2, 1, 0, 0]);
    expect(decisions[3]?.resetAt.toISOString()).toBe('2026-11-05T12:01:00.000Z');
  });

  it('starts a fresh count in the next window', async () => {
    const limiter = createInMemoryRateLimiter();
    for (let i = 0; i < 4; i++) await limiter.hit(RULE, 'client-a', T0);

    const next = await limiter.hit(RULE, 'client-a', new Date(T0.getTime() + 60_000));
    expect(next).toMatchObject({ allowed: true, remaining: 2 });
  });

  it('keeps subjects and rules independent', async () => {
    const limiter = createInMemoryRateLimiter();
    for (let i = 0; i < 4; i++) await limiter.hit(RULE, 'client-a', T0);

    expect((await limiter.hit(RULE, 'client-b', T0)).allowed).toBe(true);
    expect((await limiter.hit({ ...RULE, name: 'model' }, 'client-a', T0)).allowed).toBe(true);
  });

  it('counts concurrent hits without losing any', async () => {
    const limiter = createInMemoryRateLimiter();
    const decisions = await Promise.all(Array.from({ length: 5 }, () => limiter.hit(RULE, 'client-c', T0)));
    expect(decisions.filter((d) => d.allowed)).toHaveLength(3);
  });
});
