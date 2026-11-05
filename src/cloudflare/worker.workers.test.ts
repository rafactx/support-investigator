import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import type { RateLimitBindingLike } from './rate-limit-binding-limiter.ts';
import { createWorkerApp, type WorkerEnv } from './worker.ts';

const STRUCTURED = {
  symptomCode: 'STOCK_WITHOUT_DELIVERY_OPTIONS',
  accountScope: { accountId: 'account-17' },
  skuId: 'SKU-2002',
  seller: '1',
  quantity: 1,
  destinationPostalCode: '01310-100',
};

/** A Workers Rate Limiting binding stand-in: allows `limit` calls per key. */
function fakeBinding(limit: number): RateLimitBindingLike & { keys: string[] } {
  const counts = new Map<string, number>();
  const keys: string[] = [];
  return {
    keys,
    async limit({ key }) {
      keys.push(key);
      const count = (counts.get(key) ?? 0) + 1;
      counts.set(key, count);
      return { success: count <= limit };
    },
  };
}

function workerEnv(overrides: Partial<WorkerEnv> = {}): WorkerEnv {
  return {
    DB: env.DB,
    ASSETS: { fetch: async () => new Response('<!doctype html><title>SPA</title>', { headers: { 'content-type': 'text/html' } }) },
    LANGUAGE_MODEL_PROVIDER: 'fake',
    RATE_LIMIT_SALT: 'test-salt',
    RL_CREATE: fakeBinding(100),
    RL_MODEL: fakeBinding(100),
    RL_WRITES: fakeBinding(100),
    RL_MCP: fakeBinding(100),
    ...overrides,
  };
}

function post(app: ReturnType<typeof createWorkerApp>, path: string, body: unknown, ip = '203.0.113.7') {
  return app.request(path, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'Idempotency-Key': crypto.randomUUID(),
      'cf-connecting-ip': ip,
    },
    body: JSON.stringify(body),
  });
}

describe('Cloudflare Worker composition (workerd + local D1)', () => {
  it('runs the deterministic investigation end to end against D1: create, read back, append a review', async () => {
    const app = createWorkerApp(workerEnv());

    const created = await post(app, '/investigations', STRUCTURED);
    expect(created.status).toBe(201);
    const investigation = (await created.json()) as { id: string; revision: number; finding: { code: string } };
    expect(investigation.finding.code).toBe('DESTINATION_NOT_COVERED');

    const fetched = await app.request(`/investigations/${investigation.id}`);
    expect(fetched.status).toBe(200);
    expect(((await fetched.json()) as { id: string }).id).toBe(investigation.id);

    const reviewed = await post(app, `/investigations/${investigation.id}/reviews`, {
      expectedRevision: investigation.revision,
      outcome: 'confirmed',
      reviewerName: 'N2 on call',
    });
    expect(reviewed.status).toBe(200);
    expect(((await reviewed.json()) as { revision: number }).revision).toBe(investigation.revision + 1);
  });

  it('serves the Support MCP over stateless Streamable HTTP inside the Worker', async () => {
    const app = createWorkerApp(workerEnv());
    const client = new Client({ name: 'worker-test', version: '0.1.0' });
    await client.connect(
      new StreamableHTTPClientTransport(new URL('https://worker.test/mcp'), {
        fetch: async (url, init) => app.fetch(new Request(url, init)),
      }),
    );

    const { tools } = await client.listTools();
    const search = await client.callTool({ name: 'search_support_knowledge', arguments: { query: 'no delivery option', limit: 2 } });
    await client.close();

    expect(tools.map((tool) => tool.name)).toContain('observe_inventory');
    const text = (search.content as Array<{ type: string; text: string }>)[0]?.text ?? '';
    expect((JSON.parse(text) as { results: unknown[] }).results).toHaveLength(2);
  });

  it('answers 429 with Retry-After once a per-client binding denies, keyed by a salted digest, not the address', async () => {
    const rlCreate = fakeBinding(1);
    const app = createWorkerApp(workerEnv({ RL_CREATE: rlCreate }));

    expect((await post(app, '/investigations', STRUCTURED)).status).toBe(201);
    const denied = await post(app, '/investigations', STRUCTURED);

    expect(denied.status).toBe(429);
    expect(denied.headers.get('Retry-After')).toMatch(/^\d+$/);
    expect(rlCreate.keys.every((key) => key.startsWith('create:') && !key.includes('203.0.113.7'))).toBe(true);
  });

  it('enforces the global daily model budget in D1 across clients, while ticket-free investigations keep working', async () => {
    const app = createWorkerApp(workerEnv({ RATE_LIMIT_MODEL_PER_DAY_GLOBAL: '1' }));
    const withTicket = { ...STRUCTURED, ticketText: 'Customer says SKU-2002 has stock but no delivery option.' };

    expect((await post(app, '/investigations', withTicket, '198.51.100.1')).status).toBe(201);
    const second = await post(app, '/investigations', withTicket, '198.51.100.2');
    expect(second.status).toBe(429);
    expect(((await second.json()) as { error: { message: string } }).error.message).toMatch(/without ticket text still work/);

    expect((await post(app, '/investigations', STRUCTURED, '198.51.100.3')).status).toBe(201);
  });

  it('a valid demo key bypasses the limits; a wrong one is rejected', async () => {
    const app = createWorkerApp(workerEnv({ DEMO_KEY: 'owner-key', RL_CREATE: fakeBinding(0) }));
    const request = (key: string) =>
      app.request('/investigations', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'Idempotency-Key': crypto.randomUUID(), 'x-demo-key': key },
        body: JSON.stringify(STRUCTURED),
      });

    expect((await request('owner-key')).status).toBe(201);
    expect((await request('wrong')).status).toBe(401);
  });

  it('hands any non-API path to Static Assets', async () => {
    const app = createWorkerApp(workerEnv());

    const response = await app.request('/some/spa/path');

    expect(response.status).toBe(200);
    expect(await response.text()).toContain('<title>SPA</title>');
  });
});
