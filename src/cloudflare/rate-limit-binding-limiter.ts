import { type RateLimiter, type RateLimitRule, windowStart } from '../security/rate-limiter.ts';

/** The Workers Rate Limiting binding's API (`ratelimits` in wrangler.jsonc). */
export interface RateLimitBindingLike {
  limit(options: { key: string }): Promise<{ success: boolean }>;
}

/** The only periods the binding supports are 10 s and 60 s; this project configures 60 s. */
export const RATE_LIMIT_BINDING_PERIOD_MS = 60_000;

export interface WorkerRateLimiterOptions {
  /** Binding per rule name. A rule without one falls back to `shared`. */
  readonly bindings: Readonly<Partial<Record<string, RateLimitBindingLike>>>;
  /** Strongly consistent fixed-window counters, e.g. `createD1RateLimiter`. */
  readonly shared: RateLimiter;
  /** Rule names that must always use `shared`, whatever bindings exist. */
  readonly sharedOnly: readonly string[];
}

/**
 * Routes each rule to the right store (ADR-0048):
 *
 * - Per-client burst rules go to the Workers Rate Limiting binding: free,
 *   no storage writes, enforced at the edge location that serves the
 *   client. The binding's own `simple.limit` / `simple.period` decide; the
 *   rule's `limit` is reported back unchanged and must mirror wrangler.jsonc
 *   (a test checks that). The binding exposes no count, so `remaining` is
 *   only a lower bound (1 while allowed, 0 once denied).
 * - Rules in `sharedOnly` (the global daily model budget) and any rule
 *   without a binding go to `shared`, a strongly consistent counter. The
 *   binding is per location and eventually consistent, so it cannot be the
 *   hard bound on spend.
 */
export function createWorkerRateLimiter(options: WorkerRateLimiterOptions): RateLimiter {
  return {
    async hit(rule: RateLimitRule, subject: string, now = new Date()) {
      const binding = options.sharedOnly.includes(rule.name) ? undefined : options.bindings[rule.name];
      if (!binding) return options.shared.hit(rule, subject, now);
      const { success } = await binding.limit({ key: `${rule.name}:${subject}` });
      const start = windowStart(now, RATE_LIMIT_BINDING_PERIOD_MS);
      return {
        allowed: success,
        limit: rule.limit,
        remaining: success ? 1 : 0,
        resetAt: new Date(start.getTime() + RATE_LIMIT_BINDING_PERIOD_MS),
      };
    },
  };
}
