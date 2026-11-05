import { z } from 'zod';
import type { RawSimulation } from './simulation-record.ts';

/**
 * `simulate_fulfillment`'s normalized output: availableQuantity, price,
 * deliveryOptions[], and messages[] (e.g. `NO_DELIVERY_OPTIONS`).
 * `postalCode` is an input only — never echoed back (same PII-adjacent
 * boundary as `OrderContext`).
 */
export const FulfillmentSimulationSchema = z.object({
  skuId: z.string(),
  availableQuantity: z.number(),
  priceCents: z.number(),
  deliveryOptions: z.array(
    z.object({
      id: z.string(),
      channel: z.string(),
      priceCents: z.number(),
      transitBusinessDays: z.number(),
    })
  ),
  messages: z.array(z.string()),
});

export type FulfillmentSimulation = z.infer<typeof FulfillmentSimulationSchema>;

/**
 * Maps a raw platform fulfillment simulation to the `FulfillmentSimulation`
 * a tool returns. `NO_DELIVERY_OPTIONS` is derived here from an empty
 * `deliveryOptions[]` rather than stored as a literal in any fixture — it's a
 * fact about the simulation result, not fixture data (ADR-0006's flagship
 * demo case: stock present, zero delivery options).
 */
export function toFulfillmentSimulation(
  skuId: string,
  raw: RawSimulation
): FulfillmentSimulation {
  const line = raw.lines[0];
  const options = line?.deliveryOptions ?? [];

  const messages: string[] = [];
  if (options.length === 0) {
    messages.push('NO_DELIVERY_OPTIONS');
  }

  return {
    skuId,
    availableQuantity: line?.availableQuantity ?? 0,
    priceCents: line?.unitPriceCents ?? 0,
    deliveryOptions: options.map(({ id, channel, priceCents, transitBusinessDays }) => ({
      id,
      channel,
      priceCents,
      transitBusinessDays,
    })),
    messages,
  };
}
