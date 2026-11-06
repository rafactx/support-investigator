import type { CommerceGateway } from './commerce-gateway.ts';
import { createFixtureCommerceGateway } from './fixture-commerce-gateway.ts';

/**
 * Where every entrypoint gets its `CommerceGateway` (ADR-0005). It always
 * returns the fixture gateway today; a live adapter that passes the contract
 * suite would be selected here without changes elsewhere.
 */
export function createCommerceGateway(): CommerceGateway {
  return createFixtureCommerceGateway();
}
