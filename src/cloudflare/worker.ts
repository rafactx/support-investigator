import { Hono } from 'hono';
import { errorBody } from '../api/http-errors.ts';
import { createInvestigationsApp } from '../api/investigations-app.ts';
import { createPublicDemoGuard } from '../api/public-demo-guard.ts';
import { createFulfillmentCapabilities } from '../capabilities/create-fulfillment-capabilities.ts';
import type { InvestigationRepository } from '../domain/investigation-repository.ts';
import { createCommerceGateway } from '../gateway/create-commerce-gateway.ts';
import { loadBundledKnowledgeIndex } from '../kb/bundled-index.ts';
import type { LanguageAssistance } from '../language-assistance/types.ts';
import { createSupportMcpApp, MCP_PATH } from '../mcp/server.ts';
import type { RateLimiter } from '../security/rate-limiter.ts';
import type { D1DatabaseLike } from './d1.ts';
import { createD1InvestigationRepository } from './d1-investigation-repository.ts';
import { createD1RateLimiter } from './d1-rate-limiter.ts';
import { createWorkerRateLimiter, type RateLimitBindingLike } from './rate-limit-binding-limiter.ts';
import { createWorkerQueryEmbedProvider } from './worker-embed-provider.ts';
import { createWorkerLanguageAssistance } from './worker-language-assistance.ts';
import { MODEL_GLOBAL_RULE, readWorkerLimits, WORKER_BURST_LIMITS } from './worker-limits.ts';

/** Static Assets binding: the built SPA (`web/dist`). */
export interface AssetsFetcher {
  fetch(request: Request): Promise<Response>;
}

/**
 * Bindings and vars from wrangler.jsonc, plus the `DEMO_KEY` and
 * `RATE_LIMIT_SALT` secrets. Typed structurally so this module also
 * typechecks under Node.
 */
export interface WorkerEnv {
  readonly DB: D1DatabaseLike;
  readonly AI?: unknown;
  readonly ASSETS?: AssetsFetcher;
  readonly RL_CREATE?: RateLimitBindingLike;
  readonly RL_MODEL?: RateLimitBindingLike;
  readonly RL_WRITES?: RateLimitBindingLike;
  readonly RL_MCP?: RateLimitBindingLike;
  readonly LANGUAGE_MODEL_PROVIDER?: string;
  readonly WORKERS_AI_MODEL?: string;
  readonly LANGUAGE_ASSISTANCE_TIMEOUT_MS?: string;
  readonly RATE_LIMIT_MODEL_PER_DAY_GLOBAL?: string;
  readonly DEMO_KEY?: string;
  readonly RATE_LIMIT_SALT?: string;
}

/** Test seams; production uses the defaults built from `env`. */
export interface WorkerAppOverrides {
  readonly repository?: InvestigationRepository;
  readonly rateLimiter?: RateLimiter;
  readonly languageAssistance?: LanguageAssistance;
  readonly now?: () => Date;
}

function log(entry: object): void {
  console.log(JSON.stringify(entry));
}

/**
 * The Cloudflare live demo (ADR-0048): one Worker serving the
 * Investigations API at `/investigations`, the Support MCP at `/mcp`, and
 * the SPA from Workers Static Assets on the same origin, so no CORS is
 * needed. wrangler.jsonc routes only the API paths to this code
 * (`run_worker_first`); every other path is an asset or the SPA's
 * `index.html`.
 *
 * Every API request passes the public-demo guard first (ADR-0047). The MCP
 * app is mounted by exact path rather than `app.route('/')`: its JSON
 * pre-parse middleware would otherwise run for, and reject, investigation
 * routes.
 */
export function createWorkerApp(env: WorkerEnv, overrides: WorkerAppOverrides = {}): Hono {
  if (!env.DB) throw new Error('The D1 binding DB is not configured');
  const sharedLimiter = createD1RateLimiter(env.DB);
  const rateLimiter =
    overrides.rateLimiter ??
    createWorkerRateLimiter({
      shared: sharedLimiter,
      sharedOnly: [MODEL_GLOBAL_RULE],
      bindings: {
        create: env[WORKER_BURST_LIMITS.create.binding],
        model: env[WORKER_BURST_LIMITS.model.binding],
        writes: env[WORKER_BURST_LIMITS.writes.binding],
        mcp: env[WORKER_BURST_LIMITS.mcp.binding],
      },
    });
  if (!env.RATE_LIMIT_SALT) {
    log({ event: 'config_warning', message: 'RATE_LIMIT_SALT is not set; client digests use an empty salt' });
  }

  const gateway = createCommerceGateway();
  const knowledgeIndex = loadBundledKnowledgeIndex();
  const languageAssistance = overrides.languageAssistance ?? createWorkerLanguageAssistance(env).languageAssistance;

  const investigationsApp = createInvestigationsApp({
    capabilities: createFulfillmentCapabilities(gateway),
    repository: overrides.repository ?? createD1InvestigationRepository(env.DB),
    languageAssistance,
    createCapabilityCallId: () => crypto.randomUUID(),
    log,
  });
  const mcpApp = createSupportMcpApp({
    gateway,
    knowledgeIndex,
    queryEmbedProvider: createWorkerQueryEmbedProvider(knowledgeIndex, env.AI),
  });

  const app = new Hono();
  app.use(
    '*',
    createPublicDemoGuard({
      rateLimiter,
      limits: readWorkerLimits(env),
      demoKey: env.DEMO_KEY || undefined,
      clientKeySalt: env.RATE_LIMIT_SALT ?? '',
      log,
      now: overrides.now,
    }),
  );
  app.all(MCP_PATH, (c) => mcpApp.fetch(c.req.raw));
  app.route('/', investigationsApp);
  app.notFound((c) => (env.ASSETS ? env.ASSETS.fetch(c.req.raw) : c.json(errorBody('Not found'), 404)));
  app.onError((error, c) => {
    log({ event: 'unhandled_error', name: error.name });
    return c.json(errorBody('Internal error. Please try again.'), 500);
  });
  return app;
}

const apps = new WeakMap<object, Hono>();

export default {
  fetch(request: Request, env: WorkerEnv, ctx: unknown): Response | Promise<Response> {
    let app = apps.get(env);
    if (!app) {
      app = createWorkerApp(env);
      apps.set(env, app);
    }
    return app.fetch(request, env, ctx as never);
  },
};
