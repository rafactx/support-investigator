export interface RateLimitRule {
  /** Stable name of the rule, part of every bucket key (e.g. `create`, `model`). */
  readonly name: string;
  readonly limit: number;
  readonly windowMs: number;
}

export interface RateLimitDecision {
  readonly allowed: boolean;
  readonly limit: number;
  readonly remaining: number;
  /** When the current fixed window ends — what `Retry-After` is derived from. */
  readonly resetAt: Date;
}

/**
 * Fixed-window counter (ADR-0047) — the seam a deployment adapter backs with
 * shared storage (a database table, a platform rate-limit binding). `hit`
 * counts the request and decides in one step, so a burst cannot slip
 * between a read and an increment.
 */
export interface RateLimiter {
  hit(rule: RateLimitRule, subject: string, now?: Date): Promise<RateLimitDecision>;
}

export function windowStart(now: Date, windowMs: number): Date {
  return new Date(Math.floor(now.getTime() / windowMs) * windowMs);
}

/** The decision for the `hits`-th request in the fixed window starting at `start`. */
export function decideFixedWindow(rule: RateLimitRule, hits: number, start: Date): RateLimitDecision {
  return {
    allowed: hits <= rule.limit,
    limit: rule.limit,
    remaining: Math.max(0, rule.limit - hits),
    resetAt: new Date(start.getTime() + rule.windowMs),
  };
}

/**
 * Per-process counters for local development and tests. On serverless
 * platforms each instance has its own map, so this alone is not a real
 * bound: a public deployment supplies a `RateLimiter` backed by storage
 * every instance shares.
 */
export function createInMemoryRateLimiter(): RateLimiter {
  const counters = new Map<string, { hits: number; expiresAt: number }>();
  return {
    async hit(rule, subject, now = new Date()) {
      const start = windowStart(now, rule.windowMs);
      for (const [key, counter] of counters) {
        if (counter.expiresAt <= now.getTime()) counters.delete(key);
      }
      const key = `${rule.name}:${subject}:${start.getTime()}`;
      const counter = counters.get(key) ?? { hits: 0, expiresAt: start.getTime() + rule.windowMs };
      counter.hits += 1;
      counters.set(key, counter);
      return decideFixedWindow(rule, counter.hits, start);
    },
  };
}
