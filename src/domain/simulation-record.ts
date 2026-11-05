/**
 * Raw fulfillment-simulation shapes as the commerce platform's checkout
 * simulation returns them (provider-shaped per ADR-0005 — this is what the
 * `fixture` CommerceGateway serves and what a future live adapter would
 * receive verbatim).
 *
 * Unlike the order lookup (`order-record.ts`), an unknown/unavailable SKU
 * is not a 404 here — the simulation answers successfully with the line
 * flagged `availability: 'unavailable'`. `CommerceGateway.simulateFulfillment`
 * follows that same shape: it never throws for a SKU it doesn't recognize,
 * it returns an unavailable simulation (see `fixture-commerce-gateway.ts`).
 */

/**
 * The 4 inputs the simulation needs to price and place a single line item
 * — travel together everywhere this domain concept is used (tool input
 * schema, gateway method, fixture lookup), so they're bundled here instead
 * of passed as 4 loose parameters.
 */
export interface FulfillmentSimulationRequest {
  skuId: string;
  quantity: number;
  seller: string;
  postalCode: string;
}

export interface RawDeliveryOption {
  id: string;
  label: string;
  channel: 'delivery' | 'pickup';
  priceCents: number;
  transitBusinessDays: number;
}

export interface RawSimulation {
  lines: Array<{
    skuId: string;
    quantity: number;
    sellerId: string;
    availability: 'available' | 'partial' | 'unavailable';
    availableQuantity: number;
    unitPriceCents: number;
    compareAtPriceCents: number;
    deliveryOptions: RawDeliveryOption[];
  }>;
}
