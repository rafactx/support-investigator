import { expect, it } from 'vitest';
import type { FulfillmentSimulationRequest } from '../domain/simulation-record.ts';
import { OrderNotFoundError, type CommerceGateway } from './commerce-gateway.ts';

/**
 * Independent source of truth: the top-level fields of the platform's order
 * record (`RawOrder` in `domain/order-record.ts`), not derived from this
 * project's own normalizer. Kept here, in the shared contract, so every
 * `CommerceGateway` implementation asserts against the one copy — one shared test
 * suite, not parallel ones.
 */
export const EXPECTED_RAW_ORDER_FIELDS = [
  'id',
  'status',
  'statusLabel',
  'createdAt',
  'customer',
  'shippingAddress',
  'payments',
  'shipments',
  'events',
] as const;

/**
 * The per-implementation data `describeCommerceGatewayContract` needs to run
 * the same assertions against any implementation: an order/SKU the
 * implementation can actually resolve, plus ids/SKUs it does not recognize.
 * `fixture-commerce-gateway.contract.test.ts` supplies fixture-catalog
 * literals; a future live adapter's contract test would read a real
 * account's known-good ids from its environment instead (the "unknown"
 * cases can be any string that doesn't exist).
 */
export interface CommerceGatewayContractTarget {
  /** An orderId this implementation can resolve successfully. */
  knownOrderId: string;
  /** An orderId this implementation is guaranteed not to have. */
  unknownOrderId: string;
  /** A simulation request this implementation can resolve with stock and at least one delivery option. */
  knownSimulation: FulfillmentSimulationRequest;
  /** A simulation request for a skuId this implementation doesn't recognize. */
  unknownSkuSimulation: FulfillmentSimulationRequest;
  /** A warehouseId this implementation can resolve with at least one active loading dock. */
  knownWarehouseId: string;
  /** A dockId this implementation can resolve with at least one associated shipping policy. */
  knownDockId: string;
  /** A policyId this implementation can resolve with at least one linked dock. */
  knownPolicyId: string;
}

/**
 * Registers the `it` blocks that assert the behaviors `CommerceGateway`'s
 * own interface doc comments promise every implementation upholds
 * (ADR-0005) — the fixture today, and any live adapter added later, so
 * implementations are provably interchangeable, not just independently correct. Callers wrap this in their own
 * `describe(...)` rather than this module creating one itself, so a
 * credential-gated caller can wrap it in `describe.skipIf` without a
 * redundant nested `describe`.
 *
 * Both `getGateway` and `getTarget` are lazy (called from inside each `it`,
 * not eagerly at registration time) on purpose: `describe.skipIf` still
 * runs this function's body at collection time even when the suite ends up
 * skipped — laziness is what lets such a caller register these `it`s from
 * data that may not exist yet (no credentials configured) without
 * dereferencing it until a call that will actually run.
 */
export function describeCommerceGatewayContract(
  getGateway: () => CommerceGateway | Promise<CommerceGateway>,
  getTarget: () => CommerceGatewayContractTarget,
): void {
  it('getOrder returns a provider-shaped order for a known orderId', async () => {
    const gateway = await getGateway();
    const target = getTarget();

    const order = await gateway.getOrder(target.knownOrderId);

    for (const field of EXPECTED_RAW_ORDER_FIELDS) {
      expect(order).toHaveProperty(field);
    }
    expect(order.id).toBe(target.knownOrderId);
  });

  // A single call: OrderAccessDeniedError does not extend OrderNotFoundError,
  // so `toBeInstanceOf(OrderNotFoundError)` already excludes it — a second
  // call to assert that negatively would add no coverage.
  it('getOrder rejects with OrderNotFoundError for an unknown orderId', async () => {
    const gateway = await getGateway();
    const target = getTarget();

    await expect(
      gateway.getOrder(target.unknownOrderId),
    ).rejects.toBeInstanceOf(OrderNotFoundError);
  });

  it('getInventory returns warehouse-level stock needed to calculate usable quantity', async () => {
    const gateway = await getGateway();
    const target = getTarget();

    const inventory = await gateway.getInventory(target.knownSimulation.skuId);

    expect(inventory.skuId).toBe(target.knownSimulation.skuId);
    expect(inventory.stockLevels.length).toBeGreaterThan(0);
    for (const level of inventory.stockLevels) {
      expect(level).toMatchObject({
        warehouseId: expect.any(String),
        onHand: expect.any(Number),
        reserved: expect.any(Number),
        unlimited: expect.any(Boolean),
      });
    }
  });

  it('simulateFulfillment returns a stocked line with at least one delivery option for a known simulation', async () => {
    const gateway = await getGateway();
    const target = getTarget();

    const simulation = await gateway.simulateFulfillment(
      target.knownSimulation,
    );

    expect(simulation.lines[0]?.availableQuantity).toBeGreaterThan(0);
    expect(typeof simulation.lines[0]?.unitPriceCents).toBe('number');
    expect(simulation.lines[0]?.deliveryOptions.length).toBeGreaterThan(0);
  });

  it('simulateFulfillment never throws for an unrecognized skuId', async () => {
    const gateway = await getGateway();
    const target = getTarget();

    const simulation = await gateway.simulateFulfillment(
      target.unknownSkuSimulation,
    );

    expect(Array.isArray(simulation.lines)).toBe(true);
    expect(Array.isArray(simulation.lines[0]?.deliveryOptions)).toBe(true);
  });

  it('getWarehouse returns the loading docks needed to resolve a warehouse-to-dock route', async () => {
    const gateway = await getGateway();
    const target = getTarget();

    const warehouse = await gateway.getWarehouse(target.knownWarehouseId);

    expect(warehouse.id).toBe(target.knownWarehouseId);
    expect(warehouse.dockIds.length).toBeGreaterThan(0);
    expect(typeof warehouse.dockIds[0]).toBe('string');
  });

  it('getDock returns the shipping policy ids needed to resolve a dock-to-policy route', async () => {
    const gateway = await getGateway();
    const target = getTarget();

    const dock = await gateway.getDock(target.knownDockId);

    expect(dock.id).toBe(target.knownDockId);
    expect(dock.shippingPolicyIds.length).toBeGreaterThan(0);
  });

  it('getShippingPolicy returns the dock ids needed to confirm a dock-to-policy route', async () => {
    const gateway = await getGateway();
    const target = getTarget();

    const policy = await gateway.getShippingPolicy(target.knownPolicyId);

    expect(policy.id).toBe(target.knownPolicyId);
    expect(policy.dockIds.length).toBeGreaterThan(0);
  });

  it('getCoverageZones returns an array of coverage zones for a policy and postal code', async () => {
    const gateway = await getGateway();
    const target = getTarget();

    const zones = await gateway.getCoverageZones(
      target.knownPolicyId,
      target.knownSimulation.postalCode,
    );

    expect(Array.isArray(zones)).toBe(true);
  });
}
