import { describe } from 'vitest';
import { createFixtureCommerceGateway } from './fixture-commerce-gateway.ts';
import {
  describeCommerceGatewayContract,
  type CommerceGatewayContractTarget,
} from './commerce-gateway.contract.ts';

// Independent source of truth: the fixture catalog itself
// (`gateway/fixtures/orders.ts`, `gateway/fixtures/simulations.ts`,
// `gateway/fixtures/warehouses.ts`) — these ids/SKUs are documented there as
// the known-good / not-in-catalog cases.
const FIXTURE_TARGET: CommerceGatewayContractTarget = {
  knownOrderId: 'ORDER-1001',
  unknownOrderId: 'ORDER-DOES-NOT-EXIST',
  knownSimulation: {
    skuId: 'SKU-2001',
    quantity: 1,
    seller: '1',
    postalCode: '01310-100',
  },
  unknownSkuSimulation: {
    skuId: 'SKU-DOES-NOT-EXIST',
    quantity: 1,
    seller: '1',
    postalCode: '01310-100',
  },
  knownWarehouseId: 'WH-1',
  knownDockId: 'DOCK-1',
  knownPolicyId: 'POLICY-1',
};

describe('CommerceGateway contract: fixture', () => {
  describeCommerceGatewayContract(
    () => createFixtureCommerceGateway(),
    () => FIXTURE_TARGET,
  );
});
