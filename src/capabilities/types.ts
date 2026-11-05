import type { LedgerFact } from '../domain/finding-policy.ts';

export type CapabilityName =
  | 'inventory'
  | 'fulfillment-simulation'
  | 'warehouse-to-dock'
  | 'dock-to-policy'
  | 'destination-coverage';

export type CapabilityFailureKind =
  | 'permission_denied'
  | 'transport_failure'
  | 'schema_failure';

/** A redacted, classified failure; provider responses are intentionally absent. */
export interface CapabilityFailure {
  readonly kind: CapabilityFailureKind;
  readonly capability: CapabilityName;
  readonly message: string;
}

export interface CapabilityFactProvenance {
  readonly investigationId: string;
  readonly capabilityCallId: string;
  readonly accountScope: { readonly accountId: string };
  readonly observedAt: string;
  readonly schemaVersion: '1';
}

export type CapabilityObservation =
  | { readonly kind: 'success'; readonly fact: LedgerFact }
  | { readonly kind: 'unavailable'; readonly failure: CapabilityFailure };

export interface InventoryCapabilityInput {
  readonly skuId: string;
  readonly seller: string;
  readonly quantity: number;
  readonly provenance: CapabilityFactProvenance;
}

export interface SimulationCapabilityInput extends InventoryCapabilityInput {
  readonly destinationPostalCode: string;
}

export interface WarehouseToDockCapabilityInput {
  readonly warehouseId: string;
  readonly provenance: CapabilityFactProvenance;
}

export interface DockToPolicyCapabilityInput {
  readonly dockId: string;
  readonly provenance: CapabilityFactProvenance;
}

export interface DestinationCoverageCapabilityInput {
  readonly policyId: string;
  readonly destinationPostalCode: string;
  readonly provenance: CapabilityFactProvenance;
}

/**
 * Inventory's success case also names the warehouse the usable quantity was
 * resolved from — capability-layer plumbing for the next step
 * (warehouse-to-dock), not part of the inventory Ledger Fact itself
 * (docs/adr/0033's fact schemas are frozen; `finding-policy.ts` never
 * compares `inventory` to `warehouse-to-dock` facts directly).
 */
export type InventoryObservation =
  | {
      readonly kind: 'success';
      readonly fact: LedgerFact;
      readonly warehouseId: string;
    }
  | { readonly kind: 'unavailable'; readonly failure: CapabilityFailure };

export interface InventoryCapability {
  observe(input: InventoryCapabilityInput): Promise<InventoryObservation>;
}

export interface SimulationCapability {
  observe(input: SimulationCapabilityInput): Promise<CapabilityObservation>;
}

export interface WarehouseToDockCapability {
  observe(
    input: WarehouseToDockCapabilityInput,
  ): Promise<CapabilityObservation>;
}

export interface DockToPolicyCapability {
  observe(input: DockToPolicyCapabilityInput): Promise<CapabilityObservation>;
}

export interface DestinationCoverageCapability {
  observe(
    input: DestinationCoverageCapabilityInput,
  ): Promise<CapabilityObservation>;
}
