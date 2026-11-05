import { describe, expect, it } from 'vitest';
import { createInMemoryRateLimiter, type RateLimiter } from '../security/rate-limiter.ts';
import { createWorkerRateLimiter, type RateLimitBindingLike } from './rate-limit-binding-limiter.ts';

function recordingBinding(success: boolean): RateLimitBindingLike & { keys: string[] } {
  const keys: string[] = [];
  return {
    keys,
    async limit({ key }) {
      keys.push(key);
      return { success };
    },
  };
}

function recordingShared(): RateLimiter & { rules: string[] } {
  const inner = createInMemoryRateLimiter();
  const rules: string[] = [];
  return {
    rules,
    hit(rule, subject, now) {
      rules.push(rule.name);
      return inner.hit(rule, subject, now);
    },
  };
}

const NOW = new Date('2026-11-05T10:00:30.000Z');

describe('createWorkerRateLimiter', () => {
  it('sends a per-client rule to its binding, keyed by rule and subject', async () => {
    const binding = recordingBinding(true);
    const shared = recordingShared();
    const limiter = createWorkerRateLimiter({ bindings: { create: binding }, shared, sharedOnly: ['model-global'] });

    const decision = await limiter.hit({ name: 'create', limit: 10, windowMs: 60_000 }, 'digest-1', NOW);

    expect(binding.keys).toEqual(['create:digest-1']);
    expect(shared.rules).toEqual([]);
    expect(decision).toMatchObject({ allowed: true, limit: 10 });
    expect(decision.resetAt.toISOString()).toBe('2026-11-05T10:01:00.000Z');
  });

  it('reports a binding denial as not allowed', async () => {
    const limiter = createWorkerRateLimiter({
      bindings: { mcp: recordingBinding(false) },
      shared: recordingShared(),
      sharedOnly: [],
    });

    expect(await limiter.hit({ name: 'mcp', limit: 60, windowMs: 60_000 }, 'digest-1', NOW)).toMatchObject({
      allowed: false,
      remaining: 0,
    });
  });

  it('always sends the global model budget to the shared counter, even if a binding with that name exists', async () => {
    const binding = recordingBinding(true);
    const shared = recordingShared();
    const limiter = createWorkerRateLimiter({
      bindings: { 'model-global': binding },
      shared,
      sharedOnly: ['model-global'],
    });

    await limiter.hit({ name: 'model-global', limit: 1, windowMs: 86_400_000 }, 'all', NOW);
    const second = await limiter.hit({ name: 'model-global', limit: 1, windowMs: 86_400_000 }, 'all', NOW);

    expect(binding.keys).toEqual([]);
    expect(shared.rules).toEqual(['model-global', 'model-global']);
    expect(second.allowed).toBe(false);
  });

  it('falls back to the shared counter when a rule has no binding, so a missing binding never means no limit', async () => {
    const shared = recordingShared();
    const limiter = createWorkerRateLimiter({ bindings: {}, shared, sharedOnly: [] });

    await limiter.hit({ name: 'writes', limit: 1, windowMs: 60_000 }, 'digest-1', NOW);
    const second = await limiter.hit({ name: 'writes', limit: 1, windowMs: 60_000 }, 'digest-1', NOW);

    expect(shared.rules).toEqual(['writes', 'writes']);
    expect(second.allowed).toBe(false);
  });
});
