import type { RawShippingPolicy } from '../../domain/shipping-policy-record.ts';

/**
 * Public Reference Scenarios for the platform shipping-policy
 * endpoint, keyed by policyId:
 *
 * - `POLICY-1`: active, links back to `DOCK-1` — the positive route.
 * - `POLICY-BROKEN`: active, but links back to a different dock than the
 *   one that names it — proves dock-to-policy trusts the policy's own
 *   back-reference, not just the dock's `shippingPolicyIds`.
 *
 * Any policyId not listed here falls back to a synthetic inactive policy
 * with no linked docks in `fixture-commerce-gateway.ts`.
 */
export const FIXTURE_SHIPPING_POLICIES: Record<string, RawShippingPolicy> =
  {
    'POLICY-1': {
      id: 'POLICY-1',
      active: true,
      dockIds: ['DOCK-1'],
    },
    'POLICY-BROKEN': {
      id: 'POLICY-BROKEN',
      active: true,
      dockIds: ['DOCK-OTHER'],
    },
  };
