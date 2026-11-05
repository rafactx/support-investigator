import { type ServerType, serve } from '@hono/node-server';
import {
  Client,
  StreamableHTTPClientTransport,
} from '@modelcontextprotocol/client';
import { afterEach, describe, expect, it } from 'vitest';
import { createFixtureCommerceGateway } from '../gateway/fixture-commerce-gateway.ts';
import { fixtureKnowledgeIndex } from '../kb/fixtures/knowledge-index.fixture.ts';
import { createSupportMcpApp, createSupportMcpServer } from './server.ts';

let server: ServerType | undefined;
let client: Client | undefined;

afterEach(async () => {
  await client?.close();
  if (server) {
    await new Promise<void>((resolve, reject) => {
      server?.close((error) => (error ? reject(error) : resolve()));
    });
  }
  client = undefined;
  server = undefined;
});

async function connectClientThroughLambdaApp(): Promise<Client> {
  const app = createSupportMcpApp({
    gateway: createFixtureCommerceGateway(),
    knowledgeIndex: await fixtureKnowledgeIndex(),
  });
  const port = await new Promise<number>((resolve) => {
    server = serve({ fetch: app.fetch, port: 0 }, (info) => resolve(info.port));
  });
  client = new Client({ name: 'support-investigator-test', version: '0.1.0' });
  await client.connect(
    new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`)),
  );
  return client;
}

describe('Support MCP Lambda app', () => {
  it('serves the v2 Hono/Web Standard handler directly, without a loopback proxy', async () => {
    const mcpClient = await connectClientThroughLambdaApp();

    const { tools } = await mcpClient.listTools();

    expect(tools.map((tool) => tool.name)).toContain('observe_inventory');
  });

  it('creates a fresh MCP server for separate protocol requests', async () => {
    let createdServers = 0;
    const app = createSupportMcpApp(
      {
        gateway: createFixtureCommerceGateway(),
        knowledgeIndex: await fixtureKnowledgeIndex(),
      },
      (deps) => {
        createdServers += 1;
        return createSupportMcpServer(deps);
      },
    );
    const port = await new Promise<number>((resolve) => {
      server = serve({ fetch: app.fetch, port: 0 }, (info) =>
        resolve(info.port),
      );
    });
    client = new Client({
      name: 'support-investigator-test',
      version: '0.1.0',
    });
    await client.connect(
      new StreamableHTTPClientTransport(
        new URL(`http://127.0.0.1:${port}/mcp`),
      ),
    );

    await client.listTools();

    expect(createdServers).toBeGreaterThan(1);
  });

  it('keeps non-MCP paths outside the adapter', async () => {
    const app = createSupportMcpApp({
      gateway: createFixtureCommerceGateway(),
      knowledgeIndex: await fixtureKnowledgeIndex(),
    });

    const response = await app.request('/not-mcp', { method: 'POST' });

    expect(response.status).toBe(404);
  });
});
