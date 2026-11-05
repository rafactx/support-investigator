import { z } from 'zod';
import type { CommerceGateway } from '../gateway/commerce-gateway.ts';
import { WarehouseAccessDeniedError } from '../gateway/commerce-gateway.ts';
import type {
  WarehouseToDockCapability,
  WarehouseToDockCapabilityInput,
} from './types.ts';

const RawWarehouseSchema = z.object({
  id: z.string().min(1),
  active: z.boolean(),
  dockIds: z.array(z.string().min(1)),
});

/**
 * Resolves the loading dock the inventory-bearing warehouse ships through.
 * A platform may rank multiple docks by processing time, overhead, and
 * priority (see the "warehouse-dock-mapping" support runbook) — that
 * ranking is out of scope here;
 * the first dock the warehouse reports is used. A warehouse with no dock on
 * file has nothing to name a route to, so it is treated the same as an
 * unsupported response.
 */
export function createWarehouseToDockCapability(
  gateway: CommerceGateway,
): WarehouseToDockCapability {
  return {
    async observe(input: WarehouseToDockCapabilityInput) {
      let payload: unknown;
      try {
        payload = await gateway.getWarehouse(input.warehouseId);
      } catch (error) {
        if (error instanceof WarehouseAccessDeniedError) {
          return {
            kind: 'unavailable' as const,
            failure: {
              kind: 'permission_denied',
              capability: 'warehouse-to-dock',
              message: 'Warehouse access was denied.',
            },
          };
        }
        return {
          kind: 'unavailable' as const,
          failure: {
            kind: 'transport_failure',
            capability: 'warehouse-to-dock',
            message: 'Warehouse could not be reached.',
          },
        };
      }

      const parsed = RawWarehouseSchema.safeParse(payload);
      const dockId = parsed.success ? parsed.data.dockIds[0] : undefined;
      if (!parsed.success || parsed.data.id !== input.warehouseId || !dockId) {
        return {
          kind: 'unavailable' as const,
          failure: {
            kind: 'schema_failure',
            capability: 'warehouse-to-dock',
            message: 'Warehouse returned an unsupported response.',
          },
        };
      }

      return {
        kind: 'success' as const,
        fact: {
          ...input.provenance,
          kind: 'warehouse-to-dock',
          capability: 'warehouse-to-dock',
          warehouseId: input.warehouseId,
          dockId,
          routeAvailable: parsed.data.active,
        },
      };
    },
  };
}
