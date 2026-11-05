import { describe, expect, it } from 'vitest';
import type { RawSimulation } from './simulation-record.ts';
import { FulfillmentSimulationSchema, toFulfillmentSimulation } from './fulfillment-simulation.ts';

// Independent source of truth: simulate_fulfillment's spec — "availableQuantity,
// price, deliveryOptions[], and messages[] (e.g. NO_DELIVERY_OPTIONS)". Raw
// objects below are hand-built, not imported from the shared gateway
// fixtures, so this test doesn't just echo the normalizer's own output back
// at itself.

const RAW_WITH_DELIVERY: RawSimulation = {
  lines: [
    {
      skuId: 'SKU-2001',
      quantity: 1,
      sellerId: '1',
      availability: 'available',
      availableQuantity: 7,
      unitPriceCents: 19990,
      compareAtPriceCents: 24990,
      deliveryOptions: [
        {
          id: 'standard',
          label: 'Standard delivery',
          channel: 'delivery',
          priceCents: 1590,
          transitBusinessDays: 3,
        },
      ],
    },
  ],
};

const RAW_NO_DELIVERY_OPTIONS: RawSimulation = {
  lines: [
    {
      skuId: 'SKU-2002',
      quantity: 1,
      sellerId: '1',
      availability: 'available',
      availableQuantity: 5,
      unitPriceCents: 8990,
      compareAtPriceCents: 8990,
      deliveryOptions: [],
    },
  ],
};

describe('toFulfillmentSimulation', () => {
  it('produces availableQuantity/price/deliveryOptions for a normal, deliverable SKU', () => {
    const simulation = toFulfillmentSimulation('SKU-2001', RAW_WITH_DELIVERY);

    expect(FulfillmentSimulationSchema.safeParse(simulation).success).toBe(true);
    expect(simulation.skuId).toBe('SKU-2001');
    expect(simulation.availableQuantity).toBe(7);
    expect(simulation.priceCents).toBe(19990);
    expect(simulation.deliveryOptions).toHaveLength(1);
    expect(simulation.deliveryOptions[0]).toMatchObject({ id: 'standard', channel: 'delivery' });
    expect(simulation.messages).toEqual([]);
  });

  it('surfaces NO_DELIVERY_OPTIONS when the SKU has stock but no delivery option (ADR-0006 flagship case)', () => {
    const simulation = toFulfillmentSimulation('SKU-2002', RAW_NO_DELIVERY_OPTIONS);

    // The flagship demo case is stock present + zero delivery options, not
    // an out-of-stock SKU — assert both halves so a fixture regression that
    // silently turns this into an out-of-stock case fails loudly.
    expect(simulation.availableQuantity).toBeGreaterThan(0);
    expect(simulation.deliveryOptions).toEqual([]);
    expect(simulation.messages).toContain('NO_DELIVERY_OPTIONS');
  });
});
