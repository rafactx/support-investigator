import { describe, expect, it } from 'vitest';
import { createFixtureCommerceGateway } from './fixture-commerce-gateway.ts';
import { OrderAccessDeniedError, OrderNotFoundError } from './commerce-gateway.ts';

// The generic provider-shape check (every EXPECTED_RAW_ORDER_FIELDS present,
// unknown orderId rejects with OrderNotFoundError, SKU-2001 shape, unknown
// skuId never throws) now lives once in `commerce-gateway.contract.ts` and runs
// against this fixture too (`fixture-commerce-gateway.contract.test.ts`) — one
// shared test suite, not parallel ones. What's left
// here is fixture-catalog content no other implementation would share: specific
// field values, the payment-denied scenario, the forbidden-id scenario, and
// the exact NO_DELIVERY_OPTIONS delivery-option emptiness.

describe('createFixtureCommerceGateway', () => {
  it('returns fixture-specific order content for ORDER-1001 (email, non-empty timeline)', async () => {
    const gateway = createFixtureCommerceGateway();

    const order = await gateway.getOrder('ORDER-1001');

    expect(order.customer.email).toContain('@');
    expect(Array.isArray(order.events)).toBe(true);
    expect(order.events.length).toBeGreaterThan(0);
  });

  it('has at least one fixture order whose payment was denied', async () => {
    const gateway = createFixtureCommerceGateway();

    const order = await gateway.getOrder('ORDER-1002');

    const paymentStatuses = order.payments.map((payment) => payment.status);
    expect(paymentStatuses).toContain('denied');
  });

  // Independent source of truth: ADR-0006 — "a
  // required tool's failure (e.g. a 403)" must escalate, distinct from
  // `OrderNotFoundError` (a normal, expected outcome per that error's own
  // doc comment) — this needs a real, gateway-level failure to exercise
  // that rule end to end, not a stand-in.
  it('rejects with OrderAccessDeniedError for a permission-denied orderId', async () => {
    const gateway = createFixtureCommerceGateway();

    await expect(gateway.getOrder('ORDER-4031')).rejects.toThrow(OrderAccessDeniedError);
    try {
      await gateway.getOrder('ORDER-4031');
      throw new Error('expected getOrder to reject');
    } catch (error) {
      expect(error).toBeInstanceOf(OrderAccessDeniedError);
      expect(error).not.toBeInstanceOf(OrderNotFoundError);
      expect((error as OrderAccessDeniedError).name).toBe('OrderAccessDeniedError');
    }
  });
});

// Independent source of truth: simulate_fulfillment must return realistic
// availableQuantity/price/deliveryOptions[]/messages[]-shaped raw data,
// including a fixture scenario that
// yields NO_DELIVERY_OPTIONS.
describe('createFixtureCommerceGateway.simulateFulfillment', () => {
  it('has a fixture scenario with stock but zero delivery options (NO_DELIVERY_OPTIONS)', async () => {
    const gateway = createFixtureCommerceGateway();

    const simulation = await gateway.simulateFulfillment({
      skuId: 'SKU-2002',
      quantity: 1,
      seller: '1',
      postalCode: '01310-100',
    });

    expect(simulation.lines[0]?.availableQuantity).toBeGreaterThan(0);
    expect(simulation.lines[0]?.deliveryOptions).toEqual([]);
  });

  it('falls back to an unavailable simulation instead of throwing for an unknown skuId', async () => {
    const gateway = createFixtureCommerceGateway();

    const simulation = await gateway.simulateFulfillment({
      skuId: 'SKU-DOES-NOT-EXIST',
      quantity: 1,
      seller: '1',
      postalCode: '01310-100',
    });

    expect(simulation.lines[0]?.availability).toBe('unavailable');
  });
});
