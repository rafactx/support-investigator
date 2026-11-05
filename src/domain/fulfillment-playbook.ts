import { randomUUID } from 'node:crypto';
import {
  createEvidenceLedger,
  type EvidenceLedger,
  type LedgerFact,
} from './finding-policy.ts';
import type {
  CapabilityFailure,
  CapabilityFactProvenance,
  CapabilityName,
  DestinationCoverageCapability,
  DockToPolicyCapability,
  InventoryCapability,
  SimulationCapability,
  WarehouseToDockCapability,
} from '../capabilities/types.ts';

export interface ConfirmedFulfillmentIntake {
  readonly investigationId: string;
  readonly accountScope: { readonly accountId: string };
  readonly skuId: string;
  readonly seller: string;
  readonly quantity: number;
  readonly destinationPostalCode: string;
}

export interface FulfillmentPlaybookCapabilities {
  readonly inventory: InventoryCapability;
  readonly simulation: SimulationCapability;
  readonly warehouseToDock: WarehouseToDockCapability;
  readonly dockToPolicy: DockToPolicyCapability;
  readonly destinationCoverage: DestinationCoverageCapability;
}

export interface FulfillmentPlaybookRuntime {
  readonly now?: () => string;
  readonly createCapabilityCallId?: (capability: CapabilityName) => string;
  /** Observability hook: emits only correlation metadata, never raw capability payloads. */
  readonly onCapabilityCall?: (call: {
    readonly investigationId: string;
    readonly capability: CapabilityName;
    readonly capabilityCallId: string;
  }) => void;
}

export type FulfillmentPlaybookResult =
  | {
      readonly kind: 'observed';
      readonly ledger: EvidenceLedger;
      readonly symptomReproduced: boolean;
    }
  | {
      readonly kind: 'insufficient-evidence';
      readonly failure: CapabilityFailure;
    };

function provenance(
  intake: ConfirmedFulfillmentIntake,
  capability: CapabilityName,
  runtime: FulfillmentPlaybookRuntime,
): CapabilityFactProvenance {
  const capabilityCallId = runtime.createCapabilityCallId?.(capability) ?? randomUUID();
  runtime.onCapabilityCall?.({
    investigationId: intake.investigationId,
    capability,
    capabilityCallId,
  });
  return {
    investigationId: intake.investigationId,
    accountScope: intake.accountScope,
    capabilityCallId,
    observedAt: runtime.now?.() ?? new Date().toISOString(),
    schemaVersion: '1',
  };
}

function observed(
  facts: readonly LedgerFact[],
  symptomReproduced: boolean,
): FulfillmentPlaybookResult {
  return {
    kind: 'observed',
    ledger: createEvidenceLedger({ facts }),
    symptomReproduced,
  };
}

function schemaFailure(
  capability: CapabilityName,
  message: string,
): FulfillmentPlaybookResult {
  return {
    kind: 'insufficient-evidence',
    failure: { kind: 'schema_failure', capability, message },
  };
}

/**
 * Executes the deterministic Fulfillment Playbook: inventory, symptom
 * reproduction, then the warehouse-to-dock-to-policy route and postal-code
 * destination coverage, in evidence-driven order. Each step's Ledger Fact
 * carries the id the next step needs (`inventory`'s resolved warehouse,
 * `warehouse-to-dock`'s dock, `dock-to-policy`'s policy) — chaining the
 * ledger's own facts forward, not re-deriving them from raw payloads, is
 * what keeps `finding-policy.ts`'s cross-fact route checks satisfiable.
 *
 * A prerequisite that fails (capability `unavailable`) or contradicts the
 * positive Finding (out-of-stock, no reproduction, a broken route) stops
 * the chain immediately — destination coverage is never
 * requested after either.
 */
export async function executeFulfillmentPlaybook(
  intake: ConfirmedFulfillmentIntake,
  capabilities: FulfillmentPlaybookCapabilities,
  runtime: FulfillmentPlaybookRuntime = {},
): Promise<FulfillmentPlaybookResult> {
  const inventory = await capabilities.inventory.observe({
    skuId: intake.skuId,
    seller: intake.seller,
    quantity: intake.quantity,
    provenance: provenance(intake, 'inventory', runtime),
  });
  if (inventory.kind === 'unavailable') {
    return { kind: 'insufficient-evidence', failure: inventory.failure };
  }
  if (inventory.fact.kind !== 'inventory') {
    return schemaFailure(
      'inventory',
      'Inventory returned an unsupported observation.',
    );
  }
  if (inventory.fact.availableQuantity < intake.quantity) {
    return observed([inventory.fact], false);
  }

  const simulation = await capabilities.simulation.observe({
    skuId: intake.skuId,
    seller: intake.seller,
    quantity: intake.quantity,
    destinationPostalCode: intake.destinationPostalCode,
    provenance: provenance(intake, 'fulfillment-simulation', runtime),
  });
  if (simulation.kind === 'unavailable') {
    return { kind: 'insufficient-evidence', failure: simulation.failure };
  }
  if (simulation.fact.kind !== 'symptom-reproduction') {
    return schemaFailure(
      'fulfillment-simulation',
      'Fulfillment simulation returned an unsupported observation.',
    );
  }
  const factsAfterSimulation = [inventory.fact, simulation.fact];
  if (!simulation.fact.reproduced) {
    return observed(factsAfterSimulation, false);
  }

  const warehouseToDock = await capabilities.warehouseToDock.observe({
    warehouseId: inventory.warehouseId,
    provenance: provenance(intake, 'warehouse-to-dock', runtime),
  });
  if (warehouseToDock.kind === 'unavailable') {
    return { kind: 'insufficient-evidence', failure: warehouseToDock.failure };
  }
  if (warehouseToDock.fact.kind !== 'warehouse-to-dock') {
    return schemaFailure(
      'warehouse-to-dock',
      'Warehouse-to-dock returned an unsupported observation.',
    );
  }
  const factsAfterRoute = [...factsAfterSimulation, warehouseToDock.fact];
  if (!warehouseToDock.fact.routeAvailable) {
    return observed(factsAfterRoute, true);
  }

  const dockToPolicy = await capabilities.dockToPolicy.observe({
    dockId: warehouseToDock.fact.dockId,
    provenance: provenance(intake, 'dock-to-policy', runtime),
  });
  if (dockToPolicy.kind === 'unavailable') {
    return { kind: 'insufficient-evidence', failure: dockToPolicy.failure };
  }
  if (dockToPolicy.fact.kind !== 'dock-to-policy') {
    return schemaFailure(
      'dock-to-policy',
      'Dock-to-policy returned an unsupported observation.',
    );
  }
  const factsAfterPolicy = [...factsAfterRoute, dockToPolicy.fact];
  if (!dockToPolicy.fact.routeAvailable) {
    return observed(factsAfterPolicy, true);
  }

  const destinationCoverage = await capabilities.destinationCoverage.observe({
    policyId: dockToPolicy.fact.policyId,
    destinationPostalCode: intake.destinationPostalCode,
    provenance: provenance(intake, 'destination-coverage', runtime),
  });
  if (destinationCoverage.kind === 'unavailable') {
    return {
      kind: 'insufficient-evidence',
      failure: destinationCoverage.failure,
    };
  }
  if (destinationCoverage.fact.kind !== 'destination-coverage') {
    return schemaFailure(
      'destination-coverage',
      'Destination coverage returned an unsupported observation.',
    );
  }

  return observed([...factsAfterPolicy, destinationCoverage.fact], true);
}
