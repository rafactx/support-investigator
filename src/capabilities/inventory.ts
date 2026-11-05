import { z } from 'zod';
import type { CommerceGateway } from '../gateway/commerce-gateway.ts';
import { InventoryAccessDeniedError } from '../gateway/commerce-gateway.ts';
import type { InventoryCapability, InventoryCapabilityInput } from './types.ts';

const RawInventorySchema = z.object({
  skuId: z.string().min(1),
  stockLevels: z.array(
    z.object({
      warehouseId: z.string().min(1),
      onHand: z.number().finite(),
      reserved: z.number().finite(),
      unlimited: z.boolean(),
    }),
  ),
});

function usableQuantity(
  raw: z.infer<typeof RawInventorySchema>,
  requestedQuantity: number,
): number {
  if (raw.stockLevels.some((level) => level.unlimited)) {
    // Ledger facts deliberately use finite values; an unlimited warehouse is
    // sufficient for this requested observation, not a durable infinity.
    return requestedQuantity;
  }
  return raw.stockLevels.reduce(
    (total, level) => total + Math.max(0, level.onHand - level.reserved),
    0,
  );
}

/**
 * The inventory-bearing warehouse the warehouse-to-dock capability chains
 * from. `usableQuantity` sums stock across every warehouse, so multiple
 * warehouses can jointly satisfy a requested quantity; this picks the one
 * warehouse with the most to offer (any warehouse reporting unlimited stock
 * wins outright) as the single warehouse the fulfillment route continues
 * from — the route is scoped to one warehouse, not a merge of many.
 */
function resolveWarehouseId(
  raw: z.infer<typeof RawInventorySchema>,
): string {
  const unlimited = raw.stockLevels.find((level) => level.unlimited);
  if (unlimited) {
    return unlimited.warehouseId;
  }
  const richest = [...raw.stockLevels].sort(
    (a, b) => b.onHand - b.reserved - (a.onHand - a.reserved),
  )[0];
  return richest?.warehouseId ?? '';
}

/**
 * Obtains inventory and turns the transient provider response into the sole
 * durable inventory fact. The seller and requested quantity are preserved as
 * request context because the platform's inventory lookup is SKU-scoped.
 */
export function createInventoryCapability(
  gateway: CommerceGateway,
): InventoryCapability {
  return {
    async observe(input: InventoryCapabilityInput) {
      let payload: unknown;
      try {
        payload = await gateway.getInventory(input.skuId);
      } catch (error) {
        if (error instanceof InventoryAccessDeniedError) {
          return {
            kind: 'unavailable' as const,
            failure: {
              kind: 'permission_denied',
              capability: 'inventory',
              message: 'Inventory access was denied.',
            },
          };
        }
        return {
          kind: 'unavailable' as const,
          failure: {
            kind: 'transport_failure',
            capability: 'inventory',
            message: 'Inventory could not be reached.',
          },
        };
      }

      const parsed = RawInventorySchema.safeParse(payload);
      if (!parsed.success || parsed.data.skuId !== input.skuId) {
        return {
          kind: 'unavailable' as const,
          failure: {
            kind: 'schema_failure',
            capability: 'inventory',
            message: 'Inventory returned an unsupported response.',
          },
        };
      }

      return {
        kind: 'success' as const,
        fact: {
          ...input.provenance,
          kind: 'inventory',
          capability: 'inventory',
          skuId: input.skuId,
          seller: input.seller,
          requestedQuantity: input.quantity,
          availableQuantity: usableQuantity(parsed.data, input.quantity),
        },
        warehouseId: resolveWarehouseId(parsed.data),
      };
    },
  };
}
