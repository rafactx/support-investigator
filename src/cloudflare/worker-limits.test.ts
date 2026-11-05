import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DEFAULT_MODEL_PER_DAY_GLOBAL, MODEL_GLOBAL_RULE, readWorkerLimits, WORKER_BURST_LIMITS } from './worker-limits.ts';

interface WranglerConfig {
  readonly compatibility_flags?: string[];
  readonly ratelimits: Array<{ name: string; namespace_id: string; simple: { limit: number; period: number } }>;
  readonly vars: Record<string, string>;
  readonly d1_databases: Array<{ binding: string; migrations_dir?: string }>;
  readonly ai?: { binding: string };
  readonly assets: { not_found_handling: string; run_worker_first: string[]; directory: string };
}

/** wrangler.jsonc keeps comments on their own lines, so dropping them leaves plain JSON. */
function readWranglerConfig(): WranglerConfig {
  const text = readFileSync(new URL('../../wrangler.jsonc', import.meta.url), 'utf-8');
  const json = text
    .split('\n')
    .filter((line) => !line.trim().startsWith('//'))
    .join('\n');
  return JSON.parse(json) as WranglerConfig;
}

describe('wrangler.jsonc and the Worker limits agree', () => {
  const config = readWranglerConfig();

  it.each(Object.entries(WORKER_BURST_LIMITS))('the %s rule mirrors its rate-limit binding', (_rule, { binding, limit }) => {
    const entry = config.ratelimits.find((candidate) => candidate.name === binding);
    expect(entry?.simple).toEqual({ limit, period: 60 });
  });

  it('gives each rate limiter its own namespace', () => {
    const ids = config.ratelimits.map((entry) => entry.namespace_id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('configures the global model budget as a var and the Worker reads it', () => {
    const limits = readWorkerLimits(config.vars);
    expect(limits.modelGlobal).toEqual({
      name: MODEL_GLOBAL_RULE,
      limit: Number(config.vars.RATE_LIMIT_MODEL_PER_DAY_GLOBAL),
      windowMs: 86_400_000,
    });
  });

  it('falls back to the default budget for a missing or invalid value', () => {
    expect(readWorkerLimits({}).modelGlobal.limit).toBe(DEFAULT_MODEL_PER_DAY_GLOBAL);
    expect(readWorkerLimits({ RATE_LIMIT_MODEL_PER_DAY_GLOBAL: '-3' }).modelGlobal.limit).toBe(DEFAULT_MODEL_PER_DAY_GLOBAL);
  });

  it('binds D1 as DB with the committed migrations, and Workers AI as AI', () => {
    expect(config.d1_databases).toEqual([expect.objectContaining({ binding: 'DB', migrations_dir: 'migrations' })]);
    expect(config.ai).toEqual({ binding: 'AI' });
  });

  it('serves the SPA from web/dist and runs the Worker first only for API paths', () => {
    expect(config.assets.directory).toBe('./web/dist');
    expect(config.assets.not_found_handling).toBe('single-page-application');
    expect(config.assets.run_worker_first.sort()).toEqual(['/investigations', '/investigations/*', '/mcp', '/mcp/*']);
  });

  it('never configures a secret as a plain var', () => {
    expect(Object.keys(config.vars)).not.toContain('DEMO_KEY');
    expect(Object.keys(config.vars)).not.toContain('RATE_LIMIT_SALT');
  });
});
