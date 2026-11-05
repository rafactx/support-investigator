import {
  Client,
  StreamableHTTPClientTransport,
} from '@modelcontextprotocol/client';
import { afterEach, describe, expect, it } from 'vitest';
import { createFulfillmentCapabilities } from '../capabilities/create-fulfillment-capabilities.ts';
import { createFixtureCommerceGateway } from '../gateway/fixture-commerce-gateway.ts';
import type { CommerceGateway } from '../gateway/commerce-gateway.ts';
import { fixtureKnowledgeIndex } from '../kb/fixtures/knowledge-index.fixture.ts';
import {
  type SupportMcpHttpServer,
  startSupportMcpHttpServer,
} from './node-server.ts';

let server: SupportMcpHttpServer | undefined;
let client: Client | undefined;

const provenance = {
  investigationId: 'investigation-mcp-contract',
  capabilityCallId: 'capability-call-mcp-contract',
  accountId: 'account-mcp-contract',
  observedAt: '2026-07-31T12:00:00.000Z',
};

afterEach(async () => {
  await client?.close();
  await server?.close();
  client = undefined;
  server = undefined;
});

async function connectClient(
  gateway: CommerceGateway = createFixtureCommerceGateway(),
): Promise<Client> {
  server = await startSupportMcpHttpServer(
    { gateway, knowledgeIndex: await fixtureKnowledgeIndex() },
    { port: 0 },
  );
  client = new Client({ name: 'support-investigator-test', version: '0.1.0' });
  await client.connect(new StreamableHTTPClientTransport(server.url));
  return client;
}

function textResult(result: unknown): unknown {
  const content = (
    result as { content: Array<{ type: string; text?: string }> }
  ).content;
  return JSON.parse(content[0]?.text ?? '');
}

describe('Support MCP v2 over Streamable HTTP', () => {
  it('discovers the five focused Operational Capabilities and separate documentary search', async () => {
    const mcpClient = await connectClient();

    const { tools } = await mcpClient.listTools();

    expect(tools.map((tool) => tool.name).sort()).toEqual([
      'observe_destination_coverage',
      'observe_dock_to_policy',
      'observe_fulfillment_simulation',
      'observe_inventory',
      'observe_warehouse_to_dock',
      'search_support_knowledge',
    ]);
  });

  it('encodes the exact normalized inventory observation returned by the shared capability', async () => {
    const mcpClient = await connectClient();
    const direct = await createFulfillmentCapabilities(
      createFixtureCommerceGateway(),
    ).inventory.observe({
      skuId: 'SKU-2001',
      seller: '1',
      quantity: 1,
      provenance: {
        investigationId: provenance.investigationId,
        capabilityCallId: provenance.capabilityCallId,
        accountScope: { accountId: provenance.accountId },
        observedAt: provenance.observedAt,
        schemaVersion: '1',
      },
    });

    const result = await mcpClient.callTool({
      name: 'observe_inventory',
      arguments: { skuId: 'SKU-2001', seller: '1', quantity: 1, provenance },
    });

    expect(result.isError).toBeFalsy();
    expect(textResult(result)).toEqual(direct);
  });

  it('encodes the exact normalized fulfillment simulation observation returned by the shared capability', async () => {
    const mcpClient = await connectClient();
    const direct = await createFulfillmentCapabilities(
      createFixtureCommerceGateway(),
    ).simulation.observe({
      skuId: 'SKU-2002',
      seller: '1',
      quantity: 1,
      destinationPostalCode: '01310-100',
      provenance: {
        investigationId: provenance.investigationId,
        capabilityCallId: provenance.capabilityCallId,
        accountScope: { accountId: provenance.accountId },
        observedAt: provenance.observedAt,
        schemaVersion: '1',
      },
    });

    const result = await mcpClient.callTool({
      name: 'observe_fulfillment_simulation',
      arguments: {
        skuId: 'SKU-2002',
        seller: '1',
        quantity: 1,
        destinationPostalCode: '01310-100',
        provenance,
      },
    });

    expect(result.isError).toBeFalsy();
    expect(textResult(result)).toEqual(direct);
  });

  it('encodes the exact normalized warehouse-to-dock observation returned by the shared capability', async () => {
    const mcpClient = await connectClient();
    const direct = await createFulfillmentCapabilities(
      createFixtureCommerceGateway(),
    ).warehouseToDock.observe({
      warehouseId: 'WH-1',
      provenance: {
        investigationId: provenance.investigationId,
        capabilityCallId: provenance.capabilityCallId,
        accountScope: { accountId: provenance.accountId },
        observedAt: provenance.observedAt,
        schemaVersion: '1',
      },
    });

    const result = await mcpClient.callTool({
      name: 'observe_warehouse_to_dock',
      arguments: { warehouseId: 'WH-1', provenance },
    });

    expect(result.isError).toBeFalsy();
    expect(textResult(result)).toEqual(direct);
  });

  it('encodes the exact normalized dock-to-policy observation returned by the shared capability', async () => {
    const mcpClient = await connectClient();
    const direct = await createFulfillmentCapabilities(
      createFixtureCommerceGateway(),
    ).dockToPolicy.observe({
      dockId: 'DOCK-1',
      provenance: {
        investigationId: provenance.investigationId,
        capabilityCallId: provenance.capabilityCallId,
        accountScope: { accountId: provenance.accountId },
        observedAt: provenance.observedAt,
        schemaVersion: '1',
      },
    });

    const result = await mcpClient.callTool({
      name: 'observe_dock_to_policy',
      arguments: { dockId: 'DOCK-1', provenance },
    });

    expect(result.isError).toBeFalsy();
    expect(textResult(result)).toEqual(direct);
  });

  it('encodes the exact normalized destination-coverage observation returned by the shared capability', async () => {
    const mcpClient = await connectClient();
    const direct = await createFulfillmentCapabilities(
      createFixtureCommerceGateway(),
    ).destinationCoverage.observe({
      policyId: 'POLICY-1',
      destinationPostalCode: '01310-100',
      provenance: {
        investigationId: provenance.investigationId,
        capabilityCallId: provenance.capabilityCallId,
        accountScope: { accountId: provenance.accountId },
        observedAt: provenance.observedAt,
        schemaVersion: '1',
      },
    });

    const result = await mcpClient.callTool({
      name: 'observe_destination_coverage',
      arguments: {
        policyId: 'POLICY-1',
        destinationPostalCode: '01310-100',
        provenance,
      },
    });

    expect(result.isError).toBeFalsy();
    expect(textResult(result)).toEqual(direct);
  });

  it('returns a classified capability failure as a normal normalized observation', async () => {
    const mcpClient = await connectClient();

    const result = await mcpClient.callTool({
      name: 'observe_inventory',
      arguments: { skuId: 'SKU-403', seller: '1', quantity: 1, provenance },
    });

    expect(result.isError).toBeFalsy();
    expect(textResult(result)).toEqual({
      kind: 'unavailable',
      failure: {
        kind: 'permission_denied',
        capability: 'inventory',
        message: 'Inventory access was denied.',
      },
    });
  });

  it('encodes a capability transport failure distinctly from protocol input errors', async () => {
    const fixtureGateway = createFixtureCommerceGateway();
    const mcpClient = await connectClient({
      ...fixtureGateway,
      async getInventory() {
        throw new Error('fixture transport failed');
      },
    });

    const result = await mcpClient.callTool({
      name: 'observe_inventory',
      arguments: { skuId: 'SKU-2001', seller: '1', quantity: 1, provenance },
    });

    expect(result.isError).toBeFalsy();
    expect(textResult(result)).toMatchObject({
      kind: 'unavailable',
      failure: { kind: 'transport_failure', capability: 'inventory' },
    });
  });

  it('encodes a capability schema failure distinctly from protocol input errors', async () => {
    const fixtureGateway = createFixtureCommerceGateway();
    const mcpClient = await connectClient({
      ...fixtureGateway,
      async getInventory() {
        return {
          skuId: 'SKU-FROM-ANOTHER-REQUEST',
          stockLevels: [],
        };
      },
    });

    const result = await mcpClient.callTool({
      name: 'observe_inventory',
      arguments: { skuId: 'SKU-2001', seller: '1', quantity: 1, provenance },
    });

    expect(result.isError).toBeFalsy();
    expect(textResult(result)).toMatchObject({
      kind: 'unavailable',
      failure: { kind: 'schema_failure', capability: 'inventory' },
    });
  });

  it('keeps invalid MCP input distinct from an executable capability failure', async () => {
    const mcpClient = await connectClient();

    const result = await mcpClient.callTool({
      name: 'observe_inventory',
      arguments: { skuId: 'SKU-2001', seller: '1', quantity: 0, provenance },
    });

    expect(result.isError).toBe(true);
    expect(JSON.stringify(result)).not.toContain('permission_denied');
  });

  it('keeps unknown tools distinct from invalid input', async () => {
    const mcpClient = await connectClient();

    await expect(
      mcpClient.callTool({ name: 'does_not_exist', arguments: {} }),
    ).rejects.toThrow('Tool does_not_exist not found');
  });
});
