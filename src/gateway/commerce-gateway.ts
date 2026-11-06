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

/** The requested order does not exist. A normal outcome, surfaced as a tool error. */
export class OrderNotFoundError extends Error {
  readonly orderId: string;

  constructor(orderId: string) {
    super(`Order not found: ${orderId}`);
    this.name = 'OrderNotFoundError';
    this.orderId = orderId;
  }
}

/**
 * The caller may not view the requested order (an order API's 403). Unlike a
 * missing order, this is a capability failure that needs a human (ADR-0011).
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
 * Read-only gateway to the commerce platform (ADR-0005). The fixture gateway
 * is the only implementation. A live adapter has to implement these methods
 * and pass `describeCommerceGatewayContract`; nothing upstream changes.
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
