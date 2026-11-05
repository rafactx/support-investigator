/**
 * The read-only subset of the commerce platform's dock configuration record
 * needed to resolve the shipping policy a loading dock ships through.
 *
 * `externalRateProviders` names integrations that resolve coverage and price
 * at request time instead of through the policy's static coverage zones —
 * the mechanism behind geofenced delivery areas and dynamic or
 * external-carrier pricing (see the "runtime-rate-providers" support
 * runbook). A dock naming one has no deterministic route this capability
 * can observe.
 */
export interface RawDock {
  id: string;
  active: boolean;
  shippingPolicyIds: string[];
  externalRateProviders: string[];
}
