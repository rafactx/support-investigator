import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { createFulfillmentCapabilities } from '../capabilities/create-fulfillment-capabilities.ts';
import { createInMemoryInvestigationRepository } from '../domain/investigation-repository.ts';
import { createFixtureCommerceGateway } from '../gateway/fixture-commerce-gateway.ts';
import type { LanguageAssistance } from '../language-assistance/types.ts';
import { createInMemoryRateLimiter } from '../security/rate-limiter.ts';
import { createInvestigationsApp } from './investigations-app.ts';
import {
  classifyRequest,
  clientAddress,
  createPublicDemoGuard,
  readPublicDemoLimits,
  type PublicDemoGuardLogEntry,
} from './public-demo-guard.ts';

const STRUCTURED = {
  symptomCode: 'STOCK_WITHOUT_DELIVERY_OPTIONS',
  accountScope: { accountId: 'account-17' },
  skuId: 'SKU-2002',
  seller: '1',
  quantity: 1,
  destinationPostalCode: '01310-100',
};

function makeApp(options: { demoKey?: string; env?: NodeJS.ProcessEnv } = {}) {
  const modelCalls: string[] = [];
  const guardLog: PublicDemoGuardLogEntry[] = [];
  const languageAssistance: LanguageAssistance = {
    async extractIntake() {
      modelCalls.push('extractIntake');
      return { kind: 'extracted', fields: {} };
    },
    async improveExplanation() {
      modelCalls.push('improveExplanation');
      return { kind: 'unavailable', reason: 'test' };
    },
  };
  const app = new Hono();
  app.use(
    '*',
    createPublicDemoGuard({
      rateLimiter: createInMemoryRateLimiter(),
      limits: readPublicDemoLimits(options.env ?? {}),
      demoKey: options.demoKey,
      clientKeySalt: 'test-salt',
      log: (entry) => guardLog.push(entry),
    }),
  );
  app.route(
    '/',
    createInvestigationsApp({
      capabilities: createFulfillmentCapabilities(createFixtureCommerceGateway()),
      repository: createInMemoryInvestigationRepository(),
      languageAssistance,
    }),
  );
  return { app, modelCalls, guardLog };
}

let keyCounter = 0;
function create(app: Hono, body: unknown, headers: Record<string, string> = {}) {
  keyCounter += 1;
  return app.request('/investigations', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'Idempotency-Key': `key-${keyCounter}`,
      'cf-connecting-ip': '203.0.113.7',
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

describe('classifyRequest', () => {
  it.each([
    ['POST', '/investigations', {}, ['create']],
    ['POST', '/api/investigations', { ticketText: 'SKU-1' }, ['create', 'model']],
    ['POST', '/investigations', { ticketText: '   ' }, ['create']],
    ['POST', '/investigations/abc/explanations', {}, ['model']],
    ['PATCH', '/investigations/abc/intake', {}, ['writes']],
    ['POST', '/investigations/abc/reviews', {}, ['writes']],
    ['POST', '/mcp', {}, ['mcp']],
    ['GET', '/investigations/abc', undefined, []],
  ] as const)('%s %s counts against %j', (method, path, body, expected) => {
    expect(classifyRequest(method, path, body)).toEqual(expected);
  });
});

describe('clientAddress', () => {
  it('prefers the edge-set header, then x-real-ip, then the first forwarded hop', () => {
    expect(clientAddress(new Headers({ 'cf-connecting-ip': '1.1.1.1', 'x-real-ip': '2.2.2.2' }))).toBe('1.1.1.1');
    expect(clientAddress(new Headers({ 'x-real-ip': '2.2.2.2' }))).toBe('2.2.2.2');
    expect(clientAddress(new Headers({ 'x-forwarded-for': '3.3.3.3, 10.0.0.1' }))).toBe('3.3.3.3');
    expect(clientAddress(new Headers())).toBe('unknown');
  });
});

describe('createPublicDemoGuard', () => {
  it('lets a deterministic investigation through without any key', async () => {
    const { app, modelCalls } = makeApp();
    const response = await create(app, STRUCTURED);
    expect(response.status).toBe(201);
    expect(modelCalls).toEqual([]);
  });

  it('rate-limits creation per client with a generic 429 and Retry-After, logging details server-side', async () => {
    const { app, guardLog } = makeApp({ env: { RATE_LIMIT_CREATE_PER_HOUR: '2' } });

    expect((await create(app, STRUCTURED)).status).toBe(201);
    expect((await create(app, STRUCTURED)).status).toBe(201);
    const limited = await create(app, STRUCTURED);

    expect(limited.status).toBe(429);
    expect(Number(limited.headers.get('retry-after'))).toBeGreaterThan(0);
    expect(await limited.json()).toEqual({ error: { message: 'Too many requests. Please try again later.' } });
    expect(guardLog).toEqual([
      expect.objectContaining({ event: 'rate_limited', rule: 'create', routeClass: 'create', method: 'POST' }),
    ]);
    expect(JSON.stringify(guardLog)).not.toContain('203.0.113.7');
    expect((await create(app, STRUCTURED, { 'cf-connecting-ip': '198.51.100.9' })).status).toBe(201);
  });

  it('counts ticket text against the model limit before any model call is spent', async () => {
    const { app, modelCalls } = makeApp({ env: { RATE_LIMIT_MODEL_PER_HOUR: '1' } });
    const { skuId: _omit, ...withoutSku } = STRUCTURED;
    const withTicket = { ...withoutSku, ticketText: 'SKU-2002 shows stock but no delivery option' };

    expect((await create(app, withTicket)).status).toBe(201);
    expect(modelCalls).toEqual(['extractIntake']);
    expect((await create(app, withTicket)).status).toBe(429);
    expect(modelCalls).toEqual(['extractIntake']);
    expect((await create(app, STRUCTURED)).status).toBe(201);
  });

  it('enforces the global model budget across clients with its own message', async () => {
    const { app } = makeApp({ env: { RATE_LIMIT_MODEL_PER_DAY_GLOBAL: '1' } });
    const withTicket = { ...STRUCTURED, ticketText: 'ticket' };

    expect((await create(app, withTicket, { 'cf-connecting-ip': '198.51.100.1' })).status).toBe(201);
    const second = await create(app, withTicket, { 'cf-connecting-ip': '198.51.100.2' });
    expect(second.status).toBe(429);
    expect(((await second.json()) as { error: { message: string } }).error.message).toMatch(/budget/);
  });

  it('a valid demo key bypasses rate limits; an invalid one is rejected', async () => {
    const { app } = makeApp({ demoKey: 'owner-key', env: { RATE_LIMIT_CREATE_PER_HOUR: '1' } });

    for (let i = 0; i < 3; i++) {
      expect((await create(app, STRUCTURED, { 'x-demo-key': 'owner-key' })).status).toBe(201);
    }
    expect((await create(app, STRUCTURED, { 'x-demo-key': 'wrong' })).status).toBe(401);
  });

  it('never rate-limits reads', async () => {
    const { app } = makeApp({ env: { RATE_LIMIT_CREATE_PER_HOUR: '1', RATE_LIMIT_WRITES_PER_HOUR: '1' } });
    for (let i = 0; i < 5; i++) {
      expect((await app.request('/investigations/unknown')).status).toBe(404);
    }
  });

  it('rejects an oversized body with 413 before parsing it', async () => {
    const { app } = makeApp();
    const response = await create(app, { ...STRUCTURED, padding: 'x'.repeat(40 * 1024) });
    expect(response.status).toBe(413);
  });
});
