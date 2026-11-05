import { describe, expect, it } from 'vitest';
import { executeFulfillmentPlaybook } from '../domain/fulfillment-playbook.ts';
import { evaluateFindingPolicy } from '../domain/finding-policy.ts';
import { createFixtureCommerceGateway } from '../gateway/fixture-commerce-gateway.ts';
import {
  DockAccessDeniedError,
  CoverageZonesAccessDeniedError,
  FulfillmentSimulationAccessDeniedError,
  ShippingPolicyAccessDeniedError,
  WarehouseAccessDeniedError,
  type CommerceGateway,
} from '../gateway/commerce-gateway.ts';
import { createDestinationCoverageCapability } from './destination-coverage.ts';
import { createDockToPolicyCapability } from './dock-to-policy.ts';
import { createFulfillmentSimulationCapability } from './fulfillment-simulation.ts';
import { createInventoryCapability } from './inventory.ts';
import { createWarehouseToDockCapability } from './warehouse-to-dock.ts';

function execute(
  skuId: string,
  gateway: CommerceGateway = createFixtureCommerceGateway(),
  destinationPostalCode = '01310-100',
) {
  return executeFulfillmentPlaybook(
    {
      investigationId: 'investigation-17',
      accountScope: { accountId: 'account-17' },
      skuId,
      seller: '1',
      quantity: 1,
      destinationPostalCode,
    },
    {
      inventory: createInventoryCapability(gateway),
      simulation: createFulfillmentSimulationCapability(gateway),
      warehouseToDock: createWarehouseToDockCapability(gateway),
      dockToPolicy: createDockToPolicyCapability(gateway),
      destinationCoverage: createDestinationCoverageCapability(gateway),
    },
  );
}

/**
 * What a caller evaluates once the playbook finishes: the gathered ledger
 * when one exists, `undefined` for `insufficient-evidence` (there is no
 * ledger — `createEvidenceLedger` never produced one). `evaluateFindingPolicy`
 * fails closed to `ROOT_CAUSE_UNDETERMINED` for either —
 * permission failures and ambiguous provider responses "remain insufficient
 * and yield ROOT_CAUSE_UNDETERMINED".
 */
function findingPolicyResultFor(result: Awaited<ReturnType<typeof execute>>) {
  return evaluateFindingPolicy(
    result.kind === 'observed' ? result.ledger : undefined,
  );
}

describe('Fulfillment operational capabilities: Public Reference Scenarios', () => {
  it('records available inventory with zero delivery options as the supported symptom', async () => {
    const result = await execute('SKU-2002');

    expect(result).toMatchObject({ kind: 'observed', symptomReproduced: true });
    if (result.kind !== 'observed') throw new Error('expected observed result');
    expect(result.ledger.facts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'inventory', availableQuantity: 8 }),
        expect.objectContaining({
          kind: 'symptom-reproduction',
          reproduced: true,
        }),
      ]),
    );
  });

  it.each([
    ['ordinary out-of-stock', 'SKU-2003'],
    ['a deliverable option', 'SKU-2001'],
  ])('does not reproduce the symptom for %s', async (_scenario, skuId) => {
    const result = await execute(skuId);

    expect(result).toMatchObject({
      kind: 'observed',
      symptomReproduced: false,
    });
  });

  it('classifies an inventory permission failure as insufficient evidence', async () => {
    const result = await execute('SKU-403');

    expect(result).toEqual({
      kind: 'insufficient-evidence',
      failure: {
        kind: 'permission_denied',
        capability: 'inventory',
        message: 'Inventory access was denied.',
      },
    });
  });

  it.each([
    [
      'transport',
      async () => {
        throw new Error('provider details must not escape');
      },
      'transport_failure',
    ],
    [
      'schema',
      async () => ({
        skuId: 'SKU-2002',
        stockLevels: [{ onHand: 'invalid' }],
      }),
      'schema_failure',
    ],
  ] as const)(
    'classifies an inventory %s failure as insufficient evidence',
    async (_scenario, getInventory, kind) => {
      const gateway = {
        ...createFixtureCommerceGateway(),
        getInventory,
      } as unknown as CommerceGateway;

      const result = await execute('SKU-2002', gateway);

      expect(result).toMatchObject({
        kind: 'insufficient-evidence',
        failure: { kind, capability: 'inventory' },
      });
      expect(JSON.stringify(result)).not.toContain(
        'provider details must not escape',
      );
    },
  );

  it.each([
    [
      'permission',
      async () => {
        throw new FulfillmentSimulationAccessDeniedError('SKU-2002');
      },
      'permission_denied',
    ],
    [
      'transport',
      async () => {
        throw new Error('provider details must not escape');
      },
      'transport_failure',
    ],
    [
      'schema',
      async () => ({ lines: [] }),
      'schema_failure',
    ],
  ] as const)(
    'classifies a simulation %s failure as insufficient evidence',
    async (_scenario, simulateFulfillment, kind) => {
      const gateway = {
        ...createFixtureCommerceGateway(),
        simulateFulfillment,
      } as unknown as CommerceGateway;

      const result = await execute('SKU-2002', gateway);

      expect(result).toMatchObject({
        kind: 'insufficient-evidence',
        failure: { kind, capability: 'fulfillment-simulation' },
      });
      expect(JSON.stringify(result)).not.toContain(
        'provider details must not escape',
      );
    },
  );

  it('rejects a simulation response that changed the requested quantity', async () => {
    const gateway = {
      ...createFixtureCommerceGateway(),
      simulateFulfillment: async () => ({
        lines: [
          {
            skuId: 'SKU-2002',
            quantity: 2,
            sellerId: '1',
            availability: 'available' as const,
            availableQuantity: 8,
            unitPriceCents: 8990,
            compareAtPriceCents: 8990,
            deliveryOptions: [],
          },
        ],
      }),
    } as unknown as CommerceGateway;

    const result = await execute('SKU-2002', gateway);

    expect(result).toMatchObject({
      kind: 'insufficient-evidence',
      failure: { kind: 'schema_failure', capability: 'fulfillment-simulation' },
    });
  });

  it('proves DESTINATION_NOT_COVERED when the entire evidence path is satisfied and coverage is empty', async () => {
    const result = await execute('SKU-2002');

    expect(result).toMatchObject({ kind: 'observed' });
    if (result.kind !== 'observed') throw new Error('expected observed result');
    expect(result.ledger.facts).toHaveLength(5);
    expect(evaluateFindingPolicy(result.ledger)).toMatchObject({
      findingCode: 'DESTINATION_NOT_COVERED',
      contractResult: 'satisfied',
      decisionReason: 'contract_satisfied',
    });
  });

  it('lets a matching coverage zone contradict DESTINATION_NOT_COVERED for the same route', async () => {
    const result = await execute(
      'SKU-2002',
      createFixtureCommerceGateway(),
      '04000-000',
    );

    expect(result).toMatchObject({ kind: 'observed' });
    if (result.kind !== 'observed') throw new Error('expected observed result');
    expect(result.ledger.facts.at(-1)).toMatchObject({
      kind: 'destination-coverage',
      covered: true,
    });
    expect(evaluateFindingPolicy(result.ledger)).toMatchObject({
      findingCode: 'ROOT_CAUSE_UNDETERMINED',
      contractResult: 'contradicted',
      decisionReason: 'evidence_contradictory',
    });
  });

  it.each([
    ['an inactive inventory-bearing warehouse', 'SKU-2004'],
    ['a dock whose shipping policy does not link back to it', 'SKU-2005'],
  ])(
    'stops at a broken upstream route for %s and leaves the Finding undetermined',
    async (_scenario, skuId) => {
      const result = await execute(skuId);

      expect(result).toMatchObject({
        kind: 'observed',
        symptomReproduced: true,
      });
      if (result.kind !== 'observed')
        throw new Error('expected observed result');
      expect(
        result.ledger.facts.some(
          (fact) => fact.kind === 'destination-coverage',
        ),
      ).toBe(false);
      expect(evaluateFindingPolicy(result.ledger)).toMatchObject({
        findingCode: 'ROOT_CAUSE_UNDETERMINED',
        contractResult: 'insufficient',
        decisionReason: 'evidence_insufficient',
      });
    },
  );

  it('classifies a warehouse-to-dock permission failure as insufficient evidence', async () => {
    const gateway = {
      ...createFixtureCommerceGateway(),
      getWarehouse: async () => {
        throw new WarehouseAccessDeniedError('WH-1');
      },
    } as unknown as CommerceGateway;

    const result = await execute('SKU-2002', gateway);

    expect(result).toEqual({
      kind: 'insufficient-evidence',
      failure: {
        kind: 'permission_denied',
        capability: 'warehouse-to-dock',
        message: 'Warehouse access was denied.',
      },
    });
    expect(findingPolicyResultFor(result)).toMatchObject({
      findingCode: 'ROOT_CAUSE_UNDETERMINED',
    });
  });

  it('classifies a dock relying on an external rate provider as insufficient evidence', async () => {
    const gateway = {
      ...createFixtureCommerceGateway(),
      getWarehouse: async () => ({
        id: 'WH-1',
        active: true,
        dockIds: ['DOCK-DYNAMIC'],
      }),
    } as unknown as CommerceGateway;

    const result = await execute('SKU-2002', gateway);

    expect(result).toMatchObject({
      kind: 'insufficient-evidence',
      failure: { kind: 'schema_failure', capability: 'dock-to-policy' },
    });
    expect(findingPolicyResultFor(result)).toMatchObject({
      findingCode: 'ROOT_CAUSE_UNDETERMINED',
    });
  });

  it.each([
    [
      'permission',
      async () => {
        throw new DockAccessDeniedError('DOCK-1');
      },
      'permission_denied',
    ],
    [
      'transport',
      async () => {
        throw new Error('provider details must not escape');
      },
      'transport_failure',
    ],
    ['schema', async () => ({ id: 'DOCK-1' }), 'schema_failure'],
  ] as const)(
    'classifies a dock-to-policy %s failure at the dock as insufficient evidence',
    async (_scenario, getDock, kind) => {
      const gateway = {
        ...createFixtureCommerceGateway(),
        getDock,
      } as unknown as CommerceGateway;

      const result = await execute('SKU-2002', gateway);

      expect(result).toMatchObject({
        kind: 'insufficient-evidence',
        failure: { kind, capability: 'dock-to-policy' },
      });
      expect(JSON.stringify(result)).not.toContain(
        'provider details must not escape',
      );
      expect(findingPolicyResultFor(result)).toMatchObject({
        findingCode: 'ROOT_CAUSE_UNDETERMINED',
      });
    },
  );

  it('classifies a shipping-policy permission failure as insufficient evidence', async () => {
    const gateway = {
      ...createFixtureCommerceGateway(),
      getShippingPolicy: async () => {
        throw new ShippingPolicyAccessDeniedError('POLICY-1');
      },
    } as unknown as CommerceGateway;

    const result = await execute('SKU-2002', gateway);

    expect(result).toEqual({
      kind: 'insufficient-evidence',
      failure: {
        kind: 'permission_denied',
        capability: 'dock-to-policy',
        message: 'Shipping policy access was denied.',
      },
    });
    expect(findingPolicyResultFor(result)).toMatchObject({
      findingCode: 'ROOT_CAUSE_UNDETERMINED',
    });
  });

  it('classifies a destination-coverage permission failure as insufficient evidence', async () => {
    const gateway = {
      ...createFixtureCommerceGateway(),
      getCoverageZones: async () => {
        throw new CoverageZonesAccessDeniedError('POLICY-1');
      },
    } as unknown as CommerceGateway;

    const result = await execute('SKU-2002', gateway);

    expect(result).toEqual({
      kind: 'insufficient-evidence',
      failure: {
        kind: 'permission_denied',
        capability: 'destination-coverage',
        message: 'Coverage zones access was denied.',
      },
    });
    expect(findingPolicyResultFor(result)).toMatchObject({
      findingCode: 'ROOT_CAUSE_UNDETERMINED',
    });
  });

  it('classifies an ambiguous destination-coverage response as insufficient evidence', async () => {
    const gateway = {
      ...createFixtureCommerceGateway(),
      getCoverageZones: async () => [{ notACoverageZone: true }],
    } as unknown as CommerceGateway;

    const result = await execute('SKU-2002', gateway);

    expect(result).toMatchObject({
      kind: 'insufficient-evidence',
      failure: { kind: 'schema_failure', capability: 'destination-coverage' },
    });
    expect(findingPolicyResultFor(result)).toMatchObject({
      findingCode: 'ROOT_CAUSE_UNDETERMINED',
    });
  });
});
