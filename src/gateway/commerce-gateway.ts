import type { RawOrder } from '../domain/order-record.ts';
import type { RawInventory } from '../domain/inventory-record.ts';
import type {
  FulfillmentSimulationRequest,
  RawSimulation,
} from '../domain/simulation-record.ts';
import type { RawWarehouse } from '../domain/warehouse-record.ts';
import type { RawDock } from '../domain/dock-record.ts';
import type { RawShippingPolicy } from '../domain/shipping-policy-record.ts';
import type { RawCoverageZone } from '../domain/coverage-record.ts';

/**
 * Thrown by a CommerceGateway implementation when the requested order does not
 * exist. Distinct from a required-tool failure (ADR-0006's `needs_human`
 * "required tool failed" rule) — a missing order is a normal, expected
 * outcome the tool layer surfaces as a tool error, not an exception path.
 */
export class OrderNotFoundError extends Error {
  readonly orderId: string;

  constructor(orderId: string) {
    super(`Order not found: ${orderId}`);
    this.name = 'OrderNotFoundError';
    this.orderId = orderId;
  }
}

/**
 * Thrown by a CommerceGateway implementation when the caller is not authorized
 * to view the requested order (an order API answers this with a 403). Distinct from `OrderNotFoundError` on purpose: a missing order is
 * a normal, expected outcome (see that error's doc comment above), while a
 * permission denial *is* the required-tool failure ADR-0006's `needs_human`
 * rule exists for — the agent must never treat
 * "the platform is down"/"access denied" as a silent, investigable dead
 * end. `docs/adr/0011` records why this needed its own error/fixture rather
 * than reusing `OrderNotFoundError`.
 */
export class OrderAccessDeniedError extends Error {
  readonly orderId: string;

  constructor(orderId: string) {
    super(`Order access denied: ${orderId}`);
    this.name = 'OrderAccessDeniedError';
    this.orderId = orderId;
  }
}

/** The inventory endpoint rejected the capability's read-only credentials. */
export class InventoryAccessDeniedError extends Error {
  readonly skuId: string;

  constructor(skuId: string) {
    super(`Inventory access denied: ${skuId}`);
    this.name = 'InventoryAccessDeniedError';
    this.skuId = skuId;
  }
}

/** The fulfillment simulation endpoint rejected the capability's credentials. */
export class FulfillmentSimulationAccessDeniedError extends Error {
  readonly skuId: string;

  constructor(skuId: string) {
    super(`Fulfillment simulation access denied: ${skuId}`);
    this.name = 'FulfillmentSimulationAccessDeniedError';
    this.skuId = skuId;
  }
}

/** The warehouse configuration endpoint rejected the capability's credentials. */
export class WarehouseAccessDeniedError extends Error {
  readonly warehouseId: string;

  constructor(warehouseId: string) {
    super(`Warehouse access denied: ${warehouseId}`);
    this.name = 'WarehouseAccessDeniedError';
    this.warehouseId = warehouseId;
  }
}

/** The dock configuration endpoint rejected the capability's credentials. */
export class DockAccessDeniedError extends Error {
  readonly dockId: string;

  constructor(dockId: string) {
    super(`Dock access denied: ${dockId}`);
    this.name = 'DockAccessDeniedError';
    this.dockId = dockId;
  }
}

/** The shipping policy endpoint rejected the capability's credentials. */
export class ShippingPolicyAccessDeniedError extends Error {
  readonly policyId: string;

  constructor(policyId: string) {
    super(`Shipping policy access denied: ${policyId}`);
    this.name = 'ShippingPolicyAccessDeniedError';
    this.policyId = policyId;
  }
}

/** The coverage-zone endpoint rejected the capability's credentials. */
export class CoverageZonesAccessDeniedError extends Error {
  readonly policyId: string;

  constructor(policyId: string) {
    super(`Coverage zones access denied: ${policyId}`);
    this.name = 'CoverageZonesAccessDeniedError';
    this.policyId = policyId;
  }
}

/**
 * Read-only gateway to the commerce platform's order and fulfillment data
 * (ADR-0005). The project ships fixture-only: `createFixtureCommerceGateway`
 * is the sole implementation, serving the Public Reference Scenarios with
 * no credentials or network access.
 *
 * The interface is deliberately the seam a live adapter would plug into: a
 * real platform client only needs to implement these methods and pass the
 * shared contract suite (`describeCommerceGatewayContract` in
 * `commerce-gateway.contract.ts`), and nothing upstream of the gateway —
 * capabilities, Finding Policy, Support MCP — has to change.
 */
export interface CommerceGateway {
  getOrder(orderId: string): Promise<RawOrder>;

  /** Returns the transient, warehouse-level inventory contract for a SKU. */
  getInventory(skuId: string): Promise<RawInventory>;

  /**
   * Simulates cart fulfillment for a single SKU/quantity/seller/postal
   * code. Never throws for an unrecognized SKU — a checkout simulation
   * answers successfully with the item flagged unavailable rather than
   * 404ing (see `simulation-record.ts`).
   */
  simulateFulfillment(
    request: FulfillmentSimulationRequest,
  ): Promise<RawSimulation>;

  /** Returns the loading docks configured for a warehouse. Never throws for an unrecognized id. */
  getWarehouse(warehouseId: string): Promise<RawWarehouse>;

  /** Returns a loading dock's shipping-rate configuration. Never throws for an unrecognized id. */
  getDock(dockId: string): Promise<RawDock>;

  /** Returns a shipping policy and the docks it accepts shipments from. Never throws for an unrecognized id. */
  getShippingPolicy(policyId: string): Promise<RawShippingPolicy>;

  /**
   * Returns the coverage zones of a shipping policy that match a postal
   * code — empty when the destination is not covered (`coverage-record.ts`).
   */
  getCoverageZones(
    policyId: string,
    postalCode: string,
  ): Promise<RawCoverageZone[]>;
}
