/**
 * The read-only subset of the commerce platform's shipping policy record
 * needed to confirm a shipping policy genuinely serves a given loading
 * dock. `dockIds` is the policy's own back-reference to the docks it
 * accepts shipments from, independent of the dock's `shippingPolicyIds` —
 * the dock-to-policy capability trusts a route only when both sides agree.
 */
export interface RawShippingPolicy {
  id: string;
  active: boolean;
  dockIds: string[];
}
