import { createHash, timingSafeEqual } from 'node:crypto';
import type { MiddlewareHandler } from 'hono';
import type { RateLimiter, RateLimitRule } from '../security/rate-limiter.ts';
import { errorBody } from './http-errors.ts';

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/**
 * The public demo's abuse controls (ADR-0047), all overridable by env:
 *
 * - `create` — investigations created per client per hour.
 * - `model` — model-assisted requests (intake proposal from ticket text,
 *   explanation improvement) per client per hour.
 * - `modelGlobal` — model-assisted requests across *all* clients per day:
 *   the hard bound on model spend, independent of how many IPs a caller has.
 * - `writes` — intake corrections and Human Reviews per client per hour.
 * - `mcp` — Support MCP requests per client per hour.
 */
export interface PublicDemoLimits {
  readonly create: RateLimitRule;
  readonly model: RateLimitRule;
  readonly modelGlobal: RateLimitRule;
  readonly writes: RateLimitRule;
  readonly mcp: RateLimitRule;
}

function positiveInt(raw: string | undefined, fallback: number): number {
  const value = raw === undefined ? Number.NaN : Number(raw);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

export function readPublicDemoLimits(env: NodeJS.ProcessEnv = process.env): PublicDemoLimits {
  return {
    create: { name: 'create', limit: positiveInt(env.RATE_LIMIT_CREATE_PER_HOUR, 30), windowMs: HOUR_MS },
    model: { name: 'model', limit: positiveInt(env.RATE_LIMIT_MODEL_PER_HOUR, 10), windowMs: HOUR_MS },
    modelGlobal: {
      name: 'model-global',
      limit: positiveInt(env.RATE_LIMIT_MODEL_PER_DAY_GLOBAL, 500),
      windowMs: DAY_MS,
    },
    writes: { name: 'writes', limit: positiveInt(env.RATE_LIMIT_WRITES_PER_HOUR, 120), windowMs: HOUR_MS },
    mcp: { name: 'mcp', limit: positiveInt(env.RATE_LIMIT_MCP_PER_HOUR, 120), windowMs: HOUR_MS },
  };
}

/** Request bodies beyond this are rejected before parsing — far above any legitimate request. */
export const MAX_REQUEST_BODY_BYTES = 32 * 1024;

export interface PublicDemoGuardLogEntry {
  readonly event: 'rate_limited' | 'request_too_large' | 'demo_key_rejected';
  readonly rule?: string;
  /** A truncated salted digest of the client address — never the address itself. */
  readonly client: string;
  readonly method: string;
  readonly routeClass?: string;
}

export interface PublicDemoGuardOptions {
  readonly rateLimiter: RateLimiter;
  readonly limits: PublicDemoLimits;
  /** When set, a matching `x-demo-key` header bypasses rate limits (the owner's key). */
  readonly demoKey?: string;
  /** Salt for the client-address digest, so bucket keys can't be reversed to IPs by lookup table. */
  readonly clientKeySalt: string;
  readonly log?: (entry: PublicDemoGuardLogEntry) => void;
  readonly now?: () => Date;
}

type RouteClass = 'create' | 'model' | 'writes' | 'mcp';

/**
 * Which limits a request counts against. `path` is the full request path
 * (`/investigations/...`, optionally under an `/api` prefix, or `/mcp`). A create request counts against
 * the model limits only when it carries ticket text, because only then can
 * Language Assistance be called.
 */
export function classifyRequest(method: string, path: string, body: unknown): RouteClass[] {
  const verb = method.toUpperCase();
  if (path === '/mcp' || path.startsWith('/mcp/')) return verb === 'POST' ? ['mcp'] : [];
  const route = path.replace(/^\/api/, '');
  if (verb === 'POST' && route === '/investigations') {
    const ticketText =
      body && typeof body === 'object' ? (body as Record<string, unknown>).ticketText : undefined;
    return typeof ticketText === 'string' && ticketText.trim() !== '' ? ['create', 'model'] : ['create'];
  }
  if (verb === 'POST' && /^\/investigations\/[^/]+\/explanations$/.test(route)) return ['model'];
  if (verb === 'PATCH' && /^\/investigations\/[^/]+\/intake$/.test(route)) return ['writes'];
  if (verb === 'POST' && /^\/investigations\/[^/]+\/reviews$/.test(route)) return ['writes'];
  return [];
}

/**
 * The client address as the hosting edge reports it: `cf-connecting-ip`
 * (Cloudflare), then `x-real-ip`, then the first `x-forwarded-for` hop.
 * Only meaningful behind an edge that overwrites these headers; a
 * deployment adapter must not expose this guard directly to the internet.
 */
export function clientAddress(headers: Headers): string {
  const edgeIp = headers.get('cf-connecting-ip')?.trim();
  if (edgeIp) return edgeIp;
  const realIp = headers.get('x-real-ip')?.trim();
  if (realIp) return realIp;
  const forwarded = headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  return forwarded || 'unknown';
}

function digest(value: string): Buffer {
  return createHash('sha256').update(value).digest();
}

function demoKeyMatches(expected: string, provided: string): boolean {
  return timingSafeEqual(digest(expected), digest(provided));
}

function rulesFor(routeClass: RouteClass, limits: PublicDemoLimits): Array<{ rule: RateLimitRule; global: boolean }> {
  switch (routeClass) {
    case 'create':
      return [{ rule: limits.create, global: false }];
    case 'model':
      return [
        { rule: limits.model, global: false },
        { rule: limits.modelGlobal, global: true },
      ];
    case 'writes':
      return [{ rule: limits.writes, global: false }];
    case 'mcp':
      return [{ rule: limits.mcp, global: false }];
  }
}

const TOO_MANY_REQUESTS = 'Too many requests. Please try again later.';
const MODEL_BUDGET_EXHAUSTED =
  "The demo's language-model budget is used up for now. Investigations without ticket text still work.";

/**
 * Platform-neutral Hono middleware enforcing ADR-0047 in front of a public
 * deployment of the Investigations API and Support MCP:
 * a body-size cap, then fixed-window rate limits keyed by a salted digest of
 * the client address. Deterministic reads are never limited; a valid demo
 * key bypasses the limits; an invalid one is rejected rather than silently
 * downgraded. Every denial is logged server-side with the rule and a
 * truncated client digest, and answered with a generic message.
 */
export function createPublicDemoGuard(options: PublicDemoGuardOptions): MiddlewareHandler {
  const now = options.now ?? (() => new Date());

  return async (c, next) => {
    const headers = c.req.raw.headers;
    const client = digest(`${options.clientKeySalt}:${clientAddress(headers)}`).toString('hex').slice(0, 32);
    const method = c.req.method;

    let body: unknown;
    if (method === 'POST' || method === 'PATCH' || method === 'PUT') {
      const declared = Number(headers.get('content-length') ?? '0');
      const text = declared > MAX_REQUEST_BODY_BYTES ? undefined : await c.req.raw.clone().text();
      if (text === undefined || Buffer.byteLength(text) > MAX_REQUEST_BODY_BYTES) {
        options.log?.({ event: 'request_too_large', client: client.slice(0, 12), method });
        return c.json(errorBody('Request body is too large'), 413);
      }
      try {
        body = text === '' ? undefined : JSON.parse(text);
      } catch {
        body = undefined; // The route itself answers malformed JSON with its own 400.
      }
    }

    const providedKey = headers.get('x-demo-key');
    if (providedKey && options.demoKey) {
      if (demoKeyMatches(options.demoKey, providedKey)) return next();
      options.log?.({ event: 'demo_key_rejected', client: client.slice(0, 12), method });
      return c.json(errorBody('Invalid demo key'), 401);
    }

    for (const routeClass of classifyRequest(method, c.req.path, body)) {
      for (const { rule, global } of rulesFor(routeClass, options.limits)) {
        const decision = await options.rateLimiter.hit(rule, global ? 'all' : client, now());
        if (!decision.allowed) {
          options.log?.({ event: 'rate_limited', rule: rule.name, client: client.slice(0, 12), method, routeClass });
          const retryAfterSeconds = Math.max(1, Math.ceil((decision.resetAt.getTime() - now().getTime()) / 1000));
          c.header('Retry-After', String(retryAfterSeconds));
          return c.json(errorBody(global ? MODEL_BUDGET_EXHAUSTED : TOO_MANY_REQUESTS), 429);
        }
      }
    }
    return next();
  };
}
