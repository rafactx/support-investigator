import type { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';
import type { CapabilityFactProvenance } from '../../capabilities/types.ts';
import type { FulfillmentPlaybookCapabilities } from '../../domain/fulfillment-playbook.ts';

export type SupportMcpCapabilities = FulfillmentPlaybookCapabilities;

const provenanceSchema = z.object({
  investigationId: z.string().min(1),
  capabilityCallId: z.string().min(1),
  accountId: z.string().min(1),
  observedAt: z.string().min(1),
});

function provenance(
  input: z.infer<typeof provenanceSchema>,
): CapabilityFactProvenance {
  return {
    investigationId: input.investigationId,
    capabilityCallId: input.capabilityCallId,
    accountScope: { accountId: input.accountId },
    observedAt: input.observedAt,
    schemaVersion: '1',
  };
}

function encoded(observation: unknown) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(observation) }],
  };
}

/**
 * Registers the focused, read-only Operational Capability surface. Each tool
 * delegates straight to the corresponding shared capability: this adapter
 * validates MCP input and serializes its already-normalized observation, but
 * never reads a provider payload or evaluates a Finding.
 */
export function registerFulfillmentCapabilityTools(
  server: McpServer,
  capabilities: SupportMcpCapabilities,
): void {
  server.registerTool(
    'observe_inventory',
    {
      title: 'Observe inventory',
      description:
        'Returns the normalized inventory Operational Capability observation.',
      inputSchema: z.object({
        skuId: z.string().min(1),
        seller: z.string().min(1),
        quantity: z.number().int().positive(),
        provenance: provenanceSchema,
      }),
    },
    async ({ skuId, seller, quantity, provenance: inputProvenance }) =>
      encoded(
        await capabilities.inventory.observe({
          skuId,
          seller,
          quantity,
          provenance: provenance(inputProvenance),
        }),
      ),
  );

  server.registerTool(
    'observe_fulfillment_simulation',
    {
      title: 'Observe fulfillment simulation',
      description:
        'Returns the normalized fulfillment simulation Operational Capability observation.',
      inputSchema: z.object({
        skuId: z.string().min(1),
        seller: z.string().min(1),
        quantity: z.number().int().positive(),
        destinationPostalCode: z.string().min(1),
        provenance: provenanceSchema,
      }),
    },
    async ({
      skuId,
      seller,
      quantity,
      destinationPostalCode,
      provenance: inputProvenance,
    }) =>
      encoded(
        await capabilities.simulation.observe({
          skuId,
          seller,
          quantity,
          destinationPostalCode,
          provenance: provenance(inputProvenance),
        }),
      ),
  );

  server.registerTool(
    'observe_warehouse_to_dock',
    {
      title: 'Observe warehouse to dock',
      description:
        'Returns the normalized warehouse-to-dock Operational Capability observation.',
      inputSchema: z.object({
        warehouseId: z.string().min(1),
        provenance: provenanceSchema,
      }),
    },
    async ({ warehouseId, provenance: inputProvenance }) =>
      encoded(
        await capabilities.warehouseToDock.observe({
          warehouseId,
          provenance: provenance(inputProvenance),
        }),
      ),
  );

  server.registerTool(
    'observe_dock_to_policy',
    {
      title: 'Observe dock to policy',
      description:
        'Returns the normalized dock-to-policy Operational Capability observation.',
      inputSchema: z.object({
        dockId: z.string().min(1),
        provenance: provenanceSchema,
      }),
    },
    async ({ dockId, provenance: inputProvenance }) =>
      encoded(
        await capabilities.dockToPolicy.observe({
          dockId,
          provenance: provenance(inputProvenance),
        }),
      ),
  );

  server.registerTool(
    'observe_destination_coverage',
    {
      title: 'Observe destination coverage',
      description:
        'Returns the normalized destination-coverage Operational Capability observation.',
      inputSchema: z.object({
        policyId: z.string().min(1),
        destinationPostalCode: z.string().min(1),
        provenance: provenanceSchema,
      }),
    },
    async ({ policyId, destinationPostalCode, provenance: inputProvenance }) =>
      encoded(
        await capabilities.destinationCoverage.observe({
          policyId,
          destinationPostalCode,
          provenance: provenance(inputProvenance),
        }),
      ),
  );
}
