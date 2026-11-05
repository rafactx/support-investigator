import { describe, expect, it, vi } from 'vitest';
import {
  executeFulfillmentPlaybook,
  type FulfillmentPlaybookCapabilities,
} from './fulfillment-playbook.ts';
import type {
  CapabilityFailure,
  CapabilityObservation,
  DestinationCoverageCapability,
  DockToPolicyCapability,
  InventoryCapability,
  InventoryObservation,
  SimulationCapability,
  WarehouseToDockCapability,
} from '../capabilities/types.ts';

const INTAKE = {
  investigationId: 'investigation-17',
  accountScope: { accountId: 'account-17' },
  skuId: 'SKU-2002',
  seller: '1',
  quantity: 1,
  destinationPostalCode: '01310-100',
} as const;

function failure(
  capability: CapabilityFailure['capability'],
  kind: CapabilityFailure['kind'] = 'transport_failure',
): CapabilityFailure {
  return { kind, capability, message: 'safe failure message' };
}

function capabilities(
  overrides: Partial<FulfillmentPlaybookCapabilities> = {},
): FulfillmentPlaybookCapabilities {
  const inventory: InventoryCapability = {
    observe: vi.fn<InventoryCapability['observe']>(
      async (input): Promise<InventoryObservation> => ({
        kind: 'success',
        fact: {
          ...input.provenance,
          kind: 'inventory',
          capability: 'inventory',
          skuId: input.skuId,
          seller: input.seller,
          requestedQuantity: input.quantity,
          availableQuantity: 8,
        },
        warehouseId: 'WH-1',
      }),
    ),
  };
  const simulation: SimulationCapability = {
    observe: vi.fn<SimulationCapability['observe']>(
      async (input): Promise<CapabilityObservation> => ({
        kind: 'success',
        fact: {
          ...input.provenance,
          kind: 'symptom-reproduction',
          capability: 'fulfillment-simulation',
          symptomCode: 'STOCK_WITHOUT_DELIVERY_OPTIONS',
          skuId: input.skuId,
          seller: input.seller,
          requestedQuantity: input.quantity,
          destinationPostalCode: input.destinationPostalCode,
          reproduced: true,
        },
      }),
    ),
  };
  const warehouseToDock: WarehouseToDockCapability = {
    observe: vi.fn<WarehouseToDockCapability['observe']>(
      async (input): Promise<CapabilityObservation> => ({
        kind: 'success',
        fact: {
          ...input.provenance,
          kind: 'warehouse-to-dock',
          capability: 'warehouse-to-dock',
          warehouseId: input.warehouseId,
          dockId: 'DOCK-1',
          routeAvailable: true,
        },
      }),
    ),
  };
  const dockToPolicy: DockToPolicyCapability = {
    observe: vi.fn<DockToPolicyCapability['observe']>(
      async (input): Promise<CapabilityObservation> => ({
        kind: 'success',
        fact: {
          ...input.provenance,
          kind: 'dock-to-policy',
          capability: 'dock-to-policy',
          dockId: input.dockId,
          policyId: 'POLICY-1',
          routeAvailable: true,
        },
      }),
    ),
  };
  const destinationCoverage: DestinationCoverageCapability = {
    observe: vi.fn<DestinationCoverageCapability['observe']>(
      async (input): Promise<CapabilityObservation> => ({
        kind: 'success',
        fact: {
          ...input.provenance,
          kind: 'destination-coverage',
          capability: 'destination-coverage',
          policyId: input.policyId,
          destinationPostalCode: input.destinationPostalCode,
          covered: false,
        },
      }),
    ),
  };
  return {
    inventory,
    simulation,
    warehouseToDock,
    dockToPolicy,
    destinationCoverage,
    ...overrides,
  };
}

function asMock<T extends (...args: never[]) => unknown>(fn: T) {
  return fn as unknown as ReturnType<typeof vi.fn>;
}

describe('Fulfillment Playbook', () => {
  it('walks the full evidence-driven route in order for the positive case', async () => {
    const deps = capabilities();

    const result = await executeFulfillmentPlaybook(INTAKE, deps, {
      now: () => '2026-07-30T12:00:00.000Z',
      createCapabilityCallId: (capability) => `call-${capability}`,
    });

    expect(result).toMatchObject({ kind: 'observed', symptomReproduced: true });
    if (result.kind !== 'observed') {
      throw new Error('expected observed result');
    }
    expect(result.ledger.facts).toEqual([
      expect.objectContaining({
        kind: 'inventory',
        capabilityCallId: 'call-inventory',
      }),
      expect.objectContaining({
        kind: 'symptom-reproduction',
        capabilityCallId: 'call-fulfillment-simulation',
      }),
      expect.objectContaining({
        kind: 'warehouse-to-dock',
        warehouseId: 'WH-1',
        dockId: 'DOCK-1',
        routeAvailable: true,
        capabilityCallId: 'call-warehouse-to-dock',
      }),
      expect.objectContaining({
        kind: 'dock-to-policy',
        dockId: 'DOCK-1',
        policyId: 'POLICY-1',
        routeAvailable: true,
        capabilityCallId: 'call-dock-to-policy',
      }),
      expect.objectContaining({
        kind: 'destination-coverage',
        policyId: 'POLICY-1',
        destinationPostalCode: '01310-100',
        covered: false,
        capabilityCallId: 'call-destination-coverage',
      }),
    ]);
    expect(asMock(deps.inventory.observe)).toHaveBeenCalledBefore(
      asMock(deps.simulation.observe),
    );
    expect(asMock(deps.simulation.observe)).toHaveBeenCalledBefore(
      asMock(deps.warehouseToDock.observe),
    );
    expect(asMock(deps.warehouseToDock.observe)).toHaveBeenCalledBefore(
      asMock(deps.dockToPolicy.observe),
    );
    expect(asMock(deps.dockToPolicy.observe)).toHaveBeenCalledBefore(
      asMock(deps.destinationCoverage.observe),
    );
  });

  it.each([
    'permission_denied',
    'transport_failure',
    'schema_failure',
  ] as const)(
    'short-circuits with insufficient evidence when inventory has a %s',
    async (kind) => {
      const deps = capabilities({
        inventory: {
          observe: vi.fn<InventoryCapability['observe']>(
            async (): Promise<InventoryObservation> => ({
              kind: 'unavailable',
              failure: failure('inventory', kind),
            }),
          ),
        },
      });

      const result = await executeFulfillmentPlaybook(INTAKE, deps);

      expect(result).toEqual({
        kind: 'insufficient-evidence',
        failure: failure('inventory', kind),
      });
      expect(deps.simulation.observe).not.toHaveBeenCalled();
      expect(deps.warehouseToDock.observe).not.toHaveBeenCalled();
      expect(deps.dockToPolicy.observe).not.toHaveBeenCalled();
      expect(deps.destinationCoverage.observe).not.toHaveBeenCalled();
    },
  );

  it('records ordinary out-of-stock as a non-reproduction, not the supported symptom', async () => {
    const deps = capabilities({
      inventory: {
        observe: vi.fn<InventoryCapability['observe']>(
          async (input): Promise<InventoryObservation> => ({
            kind: 'success',
            fact: {
              ...input.provenance,
              kind: 'inventory',
              capability: 'inventory',
              skuId: input.skuId,
              seller: input.seller,
              requestedQuantity: input.quantity,
              availableQuantity: 0,
            },
            warehouseId: 'WH-1',
          }),
        ),
      },
    });

    const result = await executeFulfillmentPlaybook(INTAKE, deps);

    expect(result).toMatchObject({
      kind: 'observed',
      symptomReproduced: false,
    });
    expect(deps.simulation.observe).not.toHaveBeenCalled();
    expect(deps.warehouseToDock.observe).not.toHaveBeenCalled();
  });

  it('stops at simulation when the symptom does not reproduce, never requesting the route or coverage', async () => {
    const deps = capabilities({
      simulation: {
        observe: vi.fn<SimulationCapability['observe']>(
          async (input): Promise<CapabilityObservation> => ({
            kind: 'success',
            fact: {
              ...input.provenance,
              kind: 'symptom-reproduction',
              capability: 'fulfillment-simulation',
              symptomCode: 'STOCK_WITHOUT_DELIVERY_OPTIONS',
              skuId: input.skuId,
              seller: input.seller,
              requestedQuantity: input.quantity,
              destinationPostalCode: input.destinationPostalCode,
              reproduced: false,
            },
          }),
        ),
      },
    });

    const result = await executeFulfillmentPlaybook(INTAKE, deps);

    expect(result).toMatchObject({
      kind: 'observed',
      symptomReproduced: false,
    });
    if (result.kind !== 'observed') throw new Error('expected observed result');
    expect(result.ledger.facts).toHaveLength(2);
    expect(deps.warehouseToDock.observe).not.toHaveBeenCalled();
    expect(deps.dockToPolicy.observe).not.toHaveBeenCalled();
    expect(deps.destinationCoverage.observe).not.toHaveBeenCalled();
  });

  it.each([
    'permission_denied',
    'transport_failure',
    'schema_failure',
  ] as const)(
    'short-circuits with insufficient evidence when the warehouse-to-dock route has a %s',
    async (kind) => {
      const deps = capabilities({
        warehouseToDock: {
          observe: vi.fn<WarehouseToDockCapability['observe']>(
            async (): Promise<CapabilityObservation> => ({
              kind: 'unavailable',
              failure: failure('warehouse-to-dock', kind),
            }),
          ),
        },
      });

      const result = await executeFulfillmentPlaybook(INTAKE, deps);

      expect(result).toEqual({
        kind: 'insufficient-evidence',
        failure: failure('warehouse-to-dock', kind),
      });
      expect(deps.dockToPolicy.observe).not.toHaveBeenCalled();
      expect(deps.destinationCoverage.observe).not.toHaveBeenCalled();
    },
  );

  it('stops at a broken warehouse-to-dock route, never requesting the policy or coverage', async () => {
    const deps = capabilities({
      warehouseToDock: {
        observe: vi.fn<WarehouseToDockCapability['observe']>(
          async (input): Promise<CapabilityObservation> => ({
            kind: 'success',
            fact: {
              ...input.provenance,
              kind: 'warehouse-to-dock',
              capability: 'warehouse-to-dock',
              warehouseId: input.warehouseId,
              dockId: 'DOCK-1',
              routeAvailable: false,
            },
          }),
        ),
      },
    });

    const result = await executeFulfillmentPlaybook(INTAKE, deps);

    expect(result).toMatchObject({ kind: 'observed', symptomReproduced: true });
    if (result.kind !== 'observed') throw new Error('expected observed result');
    expect(result.ledger.facts).toHaveLength(3);
    expect(deps.dockToPolicy.observe).not.toHaveBeenCalled();
    expect(deps.destinationCoverage.observe).not.toHaveBeenCalled();
  });

  it.each([
    'permission_denied',
    'transport_failure',
    'schema_failure',
  ] as const)(
    'short-circuits with insufficient evidence when the dock-to-policy route has a %s',
    async (kind) => {
      const deps = capabilities({
        dockToPolicy: {
          observe: vi.fn<DockToPolicyCapability['observe']>(
            async (): Promise<CapabilityObservation> => ({
              kind: 'unavailable',
              failure: failure('dock-to-policy', kind),
            }),
          ),
        },
      });

      const result = await executeFulfillmentPlaybook(INTAKE, deps);

      expect(result).toEqual({
        kind: 'insufficient-evidence',
        failure: failure('dock-to-policy', kind),
      });
      expect(deps.destinationCoverage.observe).not.toHaveBeenCalled();
    },
  );

  it('stops at a broken dock-to-policy route, never requesting destination coverage', async () => {
    const deps = capabilities({
      dockToPolicy: {
        observe: vi.fn<DockToPolicyCapability['observe']>(
          async (input): Promise<CapabilityObservation> => ({
            kind: 'success',
            fact: {
              ...input.provenance,
              kind: 'dock-to-policy',
              capability: 'dock-to-policy',
              dockId: input.dockId,
              policyId: 'POLICY-1',
              routeAvailable: false,
            },
          }),
        ),
      },
    });

    const result = await executeFulfillmentPlaybook(INTAKE, deps);

    expect(result).toMatchObject({ kind: 'observed', symptomReproduced: true });
    if (result.kind !== 'observed') throw new Error('expected observed result');
    expect(result.ledger.facts).toHaveLength(4);
    expect(deps.destinationCoverage.observe).not.toHaveBeenCalled();
  });

  it.each([
    'permission_denied',
    'transport_failure',
    'schema_failure',
  ] as const)(
    'short-circuits with insufficient evidence when destination coverage has a %s',
    async (kind) => {
      const deps = capabilities({
        destinationCoverage: {
          observe: vi.fn<DestinationCoverageCapability['observe']>(
            async (): Promise<CapabilityObservation> => ({
              kind: 'unavailable',
              failure: failure('destination-coverage', kind),
            }),
          ),
        },
      });

      const result = await executeFulfillmentPlaybook(INTAKE, deps);

      expect(result).toEqual({
        kind: 'insufficient-evidence',
        failure: failure('destination-coverage', kind),
      });
    },
  );

  it('records an applicable freight value as covered, contradicting the positive Finding', async () => {
    const deps = capabilities({
      destinationCoverage: {
        observe: vi.fn<DestinationCoverageCapability['observe']>(
          async (input): Promise<CapabilityObservation> => ({
            kind: 'success',
            fact: {
              ...input.provenance,
              kind: 'destination-coverage',
              capability: 'destination-coverage',
              policyId: input.policyId,
              destinationPostalCode: input.destinationPostalCode,
              covered: true,
            },
          }),
        ),
      },
    });

    const result = await executeFulfillmentPlaybook(INTAKE, deps);

    expect(result).toMatchObject({ kind: 'observed', symptomReproduced: true });
    if (result.kind !== 'observed') throw new Error('expected observed result');
    expect(result.ledger.facts).toHaveLength(5);
    expect(result.ledger.facts.at(-1)).toMatchObject({
      kind: 'destination-coverage',
      covered: true,
    });
  });
});
