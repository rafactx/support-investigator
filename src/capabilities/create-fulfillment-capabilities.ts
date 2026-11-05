import type { FulfillmentPlaybookCapabilities } from '../domain/fulfillment-playbook.ts';
import type { CommerceGateway } from '../gateway/commerce-gateway.ts';
import { createDestinationCoverageCapability } from './destination-coverage.ts';
import { createDockToPolicyCapability } from './dock-to-policy.ts';
import { createFulfillmentSimulationCapability } from './fulfillment-simulation.ts';
import { createInventoryCapability } from './inventory.ts';
import { createWarehouseToDockCapability } from './warehouse-to-dock.ts';

/**
 * The one assembly point for the five operational capabilities used by both
 * the first-party Fulfillment Playbook and external adapters. Keeping this
 * factory at the capability boundary prevents an adapter from re-implementing
 * provider normalization or classified capability failures.
 */
export function createFulfillmentCapabilities(
  gateway: CommerceGateway,
): FulfillmentPlaybookCapabilities {
  return {
    inventory: createInventoryCapability(gateway),
    simulation: createFulfillmentSimulationCapability(gateway),
    warehouseToDock: createWarehouseToDockCapability(gateway),
    dockToPolicy: createDockToPolicyCapability(gateway),
    destinationCoverage: createDestinationCoverageCapability(gateway),
  };
}
