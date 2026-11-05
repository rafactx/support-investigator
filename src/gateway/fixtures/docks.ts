import type { RawDock } from '../../domain/dock-record.ts';

/**
 * Public Reference Scenarios for the platform dock lookup, keyed by
 * dockId:
 *
 * - `DOCK-1`: active, ships through `POLICY-1` (which links back to it) —
 *   the positive route.
 * - `DOCK-2`: active, names `POLICY-BROKEN`, a policy that exists and is
 *   active but does not list `DOCK-2` in `dockIds` — a
 *   dock-to-policy route that fails closed on an unconfirmed back-reference.
 * - `DOCK-DYNAMIC`: names an external rate provider instead of relying
 *   solely on the policy's static coverage zones — the geofenced-area and
 *   dynamic/external-carrier case that must stay insufficient.
 *
 * Any dockId not listed here (including `DOCK-BROKEN-WAREHOUSE`, `WH-2`'s
 * dock) falls back to a synthetic inactive dock with no shipping policy in
 * `fixture-commerce-gateway.ts` — `WH-2`'s route already fails at the
 * warehouse step, so its dock is never actually looked up.
 */
export const FIXTURE_DOCKS: Record<string, RawDock> = {
  'DOCK-1': {
    id: 'DOCK-1',
    active: true,
    shippingPolicyIds: ['POLICY-1'],
    externalRateProviders: [],
  },
  'DOCK-2': {
    id: 'DOCK-2',
    active: true,
    shippingPolicyIds: ['POLICY-BROKEN'],
    externalRateProviders: [],
  },
  'DOCK-DYNAMIC': {
    id: 'DOCK-DYNAMIC',
    active: true,
    shippingPolicyIds: ['POLICY-1'],
    externalRateProviders: ['acme-dynamic-rates'],
  },
};
