import { z } from 'zod';
import type { CommerceGateway } from '../gateway/commerce-gateway.ts';
import { FulfillmentSimulationAccessDeniedError } from '../gateway/commerce-gateway.ts';
import type { SimulationCapability, SimulationCapabilityInput } from './types.ts';

const RawSimulationSchema = z.object({
  lines: z.array(
    z.object({
      skuId: z.string(),
      quantity: z.number(),
      sellerId: z.string(),
      availability: z.enum(['available', 'partial', 'unavailable']),
      availableQuantity: z.number().finite(),
      unitPriceCents: z.number().finite(),
      compareAtPriceCents: z.number().finite(),
      deliveryOptions: z.array(
        z.object({
          id: z.string(),
          label: z.string(),
          channel: z.enum(['delivery', 'pickup']),
          priceCents: z.number().finite(),
          transitBusinessDays: z.number().finite(),
        })
      ),
    })
  ),
});

/** Turns a simulation response into the symptom fact without retaining its raw payload. */
export function createFulfillmentSimulationCapability(gateway: CommerceGateway): SimulationCapability {
  return {
    async observe(input: SimulationCapabilityInput) {
      let payload: unknown;
      try {
        payload = await gateway.simulateFulfillment({
          skuId: input.skuId,
          seller: input.seller,
          quantity: input.quantity,
          postalCode: input.destinationPostalCode,
        });
      } catch (error) {
        if (error instanceof FulfillmentSimulationAccessDeniedError) {
          return {
            kind: 'unavailable' as const,
            failure: {
              kind: 'permission_denied',
              capability: 'fulfillment-simulation',
              message: 'Fulfillment simulation access was denied.',
            },
          };
        }
        return {
          kind: 'unavailable' as const,
          failure: {
            kind: 'transport_failure',
            capability: 'fulfillment-simulation',
            message: 'Fulfillment simulation could not be reached.',
          },
        };
      }

      const parsed = RawSimulationSchema.safeParse(payload);
      const line = parsed.success ? parsed.data.lines[0] : undefined;
      if (
        !parsed.success ||
        !line ||
        line.skuId !== input.skuId ||
        line.sellerId !== input.seller ||
        line.quantity !== input.quantity
      ) {
        return {
          kind: 'unavailable' as const,
          failure: {
            kind: 'schema_failure',
            capability: 'fulfillment-simulation',
            message: 'Fulfillment simulation returned an unsupported response.',
          },
        };
      }

      return {
        kind: 'success' as const,
        fact: {
          ...input.provenance,
          kind: 'symptom-reproduction',
          capability: 'fulfillment-simulation',
          symptomCode: 'STOCK_WITHOUT_DELIVERY_OPTIONS',
          skuId: input.skuId,
          seller: input.seller,
          requestedQuantity: input.quantity,
          destinationPostalCode: input.destinationPostalCode,
          reproduced: line.availableQuantity >= input.quantity && line.deliveryOptions.length === 0,
        },
      };
    },
  };
}
