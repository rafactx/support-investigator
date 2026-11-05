import type { RawSimulation } from '../../domain/simulation-record.ts';

/**
 * Fixture fulfillment simulations, provider-shaped per ADR-0005. Two
 * scenarios, keyed by skuId:
 *
 * - `SKU-2001`: in stock, at least one delivery option — normal case.
 * - `SKU-2002`: in stock (`availableQuantity > 0`) but zero delivery options — the
 *   `NO_DELIVERY_OPTIONS` case, and ADR-0006's named flagship demo ticket
 *   ("the SKU has stock but no delivery option shows up"). Deliberately
 *   *not* an out-of-stock SKU — that's a different, unrelated failure mode.
 *
 * Any skuId not listed here falls back to `UNKNOWN_SKU_SIMULATION` in
 * `fixture-commerce-gateway.ts`, matching a checkout simulation's behavior of
 * a successful response with an unavailable line instead of a 404.
 */
export const FIXTURE_SIMULATIONS: Record<string, RawSimulation> = {
  'SKU-2001': {
    lines: [
      {
        skuId: 'SKU-2001',
        quantity: 1,
        sellerId: '1',
        availability: 'available',
        availableQuantity: 12,
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
          {
            id: 'express',
            label: 'Express delivery',
            channel: 'delivery',
            priceCents: 3490,
            transitBusinessDays: 1,
          },
        ],
      },
    ],
  },
  'SKU-2002': {
    lines: [
      {
        skuId: 'SKU-2002',
        quantity: 1,
        sellerId: '1',
        availability: 'available',
        availableQuantity: 8,
        unitPriceCents: 8990,
        compareAtPriceCents: 8990,
        deliveryOptions: [],
      },
    ],
  },
  'SKU-2003': {
    lines: [
      {
        skuId: 'SKU-2003',
        quantity: 1,
        sellerId: '1',
        availability: 'unavailable',
        availableQuantity: 0,
        unitPriceCents: 8990,
        compareAtPriceCents: 8990,
        deliveryOptions: [],
      },
    ],
  },
  // Reproduces the symptom, same shape as SKU-2002 — the warehouse-to-dock
  // and dock-to-policy route-break scenarios need to reach those
  // capabilities, not stop at the symptom-reproduction gate.
  'SKU-2004': {
    lines: [
      {
        skuId: 'SKU-2004',
        quantity: 1,
        sellerId: '1',
        availability: 'available',
        availableQuantity: 8,
        unitPriceCents: 8990,
        compareAtPriceCents: 8990,
        deliveryOptions: [],
      },
    ],
  },
  'SKU-2005': {
    lines: [
      {
        skuId: 'SKU-2005',
        quantity: 1,
        sellerId: '1',
        availability: 'available',
        availableQuantity: 8,
        unitPriceCents: 8990,
        compareAtPriceCents: 8990,
        deliveryOptions: [],
      },
    ],
  },
};

/**
 * Fallback for a skuId `FIXTURE_SIMULATIONS` doesn't recognize — an
 * unavailable line with no delivery options, not an error. See
 * `commerce-gateway.ts`'s doc comment on why `simulateFulfillment` never
 * throws for an unknown SKU.
 */
export const UNKNOWN_SKU_SIMULATION: RawSimulation = {
    lines: [
      {
        skuId: 'UNKNOWN',
        quantity: 1,
        sellerId: '1',
        availability: 'unavailable',
        availableQuantity: 0,
        unitPriceCents: 0,
        compareAtPriceCents: 0,
        deliveryOptions: [],
      },
    ],
};
