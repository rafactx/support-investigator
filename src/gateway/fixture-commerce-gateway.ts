import { FIXTURE_ORDERS, FORBIDDEN_ORDER_IDS } from './fixtures/orders.ts';
import {
  FIXTURE_SIMULATIONS,
  UNKNOWN_SKU_SIMULATION,
} from './fixtures/simulations.ts';
import { FIXTURE_INVENTORIES } from './fixtures/inventories.ts';
import { FIXTURE_WAREHOUSES } from './fixtures/warehouses.ts';
import { FIXTURE_DOCKS } from './fixtures/docks.ts';
import { FIXTURE_SHIPPING_POLICIES } from './fixtures/shipping-policies.ts';
import {
  FIXTURE_COVERAGE_ZONES,
  coverageKey,
} from './fixtures/coverage-zones.ts';
import {
  DockAccessDeniedError,
  CoverageZonesAccessDeniedError,
  InventoryAccessDeniedError,
  OrderAccessDeniedError,
  OrderNotFoundError,
  ShippingPolicyAccessDeniedError,
  WarehouseAccessDeniedError,
  type CommerceGateway,
} from './commerce-gateway.ts';

/**
 * Fixture `CommerceGateway` (ADR-0005) — the project's only implementation.
 * Returns realistic, provider-shaped order, inventory, simulation and
 * logistics data for the Public Reference Scenarios, with no credentials
 * and no network access.
 */
export function createFixtureCommerceGateway(): CommerceGateway {
  return {
    async getOrder(orderId) {
      if (FORBIDDEN_ORDER_IDS.has(orderId)) {
        throw new OrderAccessDeniedError(orderId);
      }
      const order = FIXTURE_ORDERS[orderId];
      if (!order) {
        throw new OrderNotFoundError(orderId);
      }
      return order;
    },

    async getInventory(skuId) {
      if (skuId === 'SKU-403') {
        throw new InventoryAccessDeniedError(skuId);
      }
      return (
        FIXTURE_INVENTORIES[skuId] ?? {
          skuId,
          stockLevels: [
            {
              warehouseId: 'WH-UNKNOWN',
              onHand: 0,
              reserved: 0,
              unlimited: false,
            },
          ],
        }
      );
    },

    async simulateFulfillment({ skuId }) {
      return FIXTURE_SIMULATIONS[skuId] ?? UNKNOWN_SKU_SIMULATION;
    },

    async getWarehouse(warehouseId) {
      if (warehouseId === 'WH-403') {
        throw new WarehouseAccessDeniedError(warehouseId);
      }
      return (
        FIXTURE_WAREHOUSES[warehouseId] ?? {
          id: warehouseId,
          active: false,
          dockIds: [],
        }
      );
    },

    async getDock(dockId) {
      if (dockId === 'DOCK-403') {
        throw new DockAccessDeniedError(dockId);
      }
      return (
        FIXTURE_DOCKS[dockId] ?? {
          id: dockId,
          active: false,
          shippingPolicyIds: [],
          externalRateProviders: [],
        }
      );
    },

    async getShippingPolicy(policyId) {
      if (policyId === 'POLICY-403') {
        throw new ShippingPolicyAccessDeniedError(policyId);
      }
      return (
        FIXTURE_SHIPPING_POLICIES[policyId] ?? {
          id: policyId,
          active: false,
          dockIds: [],
        }
      );
    },

    async getCoverageZones(policyId, postalCode) {
      if (policyId === 'POLICY-COVERAGE-403') {
        throw new CoverageZonesAccessDeniedError(policyId);
      }
      return FIXTURE_COVERAGE_ZONES[coverageKey(policyId, postalCode)] ?? [];
    },
  };
}
