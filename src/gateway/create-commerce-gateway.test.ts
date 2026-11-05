import { afterEach, describe, expect, it, vi } from 'vitest';
import { createCommerceGateway } from './create-commerce-gateway.ts';
import { createFixtureCommerceGateway } from './fixture-commerce-gateway.ts';

// Independent source of truth: the gateway factory's requirements — the factory
// is the single call site every entrypoint uses to obtain a gateway, and the
// project runs on fixtures only (no credentials, no network).

describe('createCommerceGateway', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns the fixture gateway', async () => {
    const gateway = createCommerceGateway();
    const fixtureGateway = createFixtureCommerceGateway();

    const order = await gateway.getOrder('ORDER-1001');
    const fixtureOrder = await fixtureGateway.getOrder('ORDER-1001');

    expect(order).toEqual(fixtureOrder);
  });

  it('never touches the network', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const gateway = createCommerceGateway();
    await gateway.getOrder('ORDER-1001');
    await gateway.getInventory('SKU-2001');
    await gateway.simulateFulfillment({
      skuId: 'SKU-2001',
      quantity: 1,
      seller: '1',
      postalCode: '01310-100',
    });

    expect(fetchMock).not.toHaveBeenCalled();
  });
});
