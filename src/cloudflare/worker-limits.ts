import type { PublicDemoLimits } from '../api/public-demo-guard.ts';
import { RATE_LIMIT_BINDING_PERIOD_MS } from './rate-limit-binding-limiter.ts';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Per-client limits the Workers Rate Limiting bindings enforce, per 60 s.
 * They are configured in wrangler.jsonc (`ratelimits[].simple.limit`); these
 * constants only mirror them for logs and the fallback path, and
 * `worker-limits.test.ts` fails if the two drift apart.
 */
export const WORKER_BURST_LIMITS = {
  create: { binding: 'RL_CREATE', limit: 10 },
  model: { binding: 'RL_MODEL', limit: 3 },
  writes: { binding: 'RL_WRITES', limit: 30 },
  mcp: { binding: 'RL_MCP', limit: 60 },
} as const;

/**
 * Model-assisted requests per UTC day across all clients. At the default
 * model's prices one call costs well under 200 Workers AI Neurons, so 50
 * calls stay inside the 10,000-Neuron daily free allocation.
 */
export const DEFAULT_MODEL_PER_DAY_GLOBAL = 50;

export const MODEL_GLOBAL_RULE = 'model-global';

function positiveInt(raw: string | undefined, fallback: number): number {
  const value = raw === undefined ? Number.NaN : Number(raw);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

/**
 * The Worker's `PublicDemoLimits` (ADR-0048). Same rule names as
 * `readPublicDemoLimits`, but per-client rules use the binding's 60 s window
 * and the global model budget is per UTC day, read from
 * `RATE_LIMIT_MODEL_PER_DAY_GLOBAL`.
 */
export function readWorkerLimits(env: { readonly RATE_LIMIT_MODEL_PER_DAY_GLOBAL?: string }): PublicDemoLimits {
  const burst = (name: keyof typeof WORKER_BURST_LIMITS) => ({
    name,
    limit: WORKER_BURST_LIMITS[name].limit,
    windowMs: RATE_LIMIT_BINDING_PERIOD_MS,
  });
  return {
    create: burst('create'),
    model: burst('model'),
    writes: burst('writes'),
    mcp: burst('mcp'),
    modelGlobal: {
      name: MODEL_GLOBAL_RULE,
      limit: positiveInt(env.RATE_LIMIT_MODEL_PER_DAY_GLOBAL, DEFAULT_MODEL_PER_DAY_GLOBAL),
      windowMs: DAY_MS,
    },
  };
}
