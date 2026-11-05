import { z } from 'zod';
import type { CommerceGateway } from '../gateway/commerce-gateway.ts';
import {
  DockAccessDeniedError,
  ShippingPolicyAccessDeniedError,
} from '../gateway/commerce-gateway.ts';
import type {
  CapabilityObservation,
  DockToPolicyCapability,
  DockToPolicyCapabilityInput,
} from './types.ts';

const RawDockSchema = z.object({
  id: z.string().min(1),
  active: z.boolean(),
  shippingPolicyIds: z.array(z.string().min(1)),
  externalRateProviders: z.array(z.string().min(1)),
});

const RawShippingPolicySchema = z.object({
  id: z.string().min(1),
  active: z.boolean(),
  dockIds: z.array(z.string().min(1)),
});

function unavailable(
  kind: 'permission_denied' | 'transport_failure' | 'schema_failure',
  message: string,
): CapabilityObservation {
  return {
    kind: 'unavailable',
    failure: { kind, capability: 'dock-to-policy', message },
  };
}

/**
 * Resolves the shipping policy a loading dock ships through, and confirms
 * the policy names the dock back via its own `dockIds` — trusting only the
 * dock's `shippingPolicyIds` would let an unlinked or stale policy id
 * fabricate a route the policy itself doesn't recognize.
 *
 * A dock naming an external rate provider relies on coverage resolved at
 * request time — the platform's mechanism for geofenced coverage and
 * dynamic or external-carrier pricing (`dock-record.ts`) — which this
 * capability, reading only static coverage zones, cannot observe.
 */
export function createDockToPolicyCapability(
  gateway: CommerceGateway,
): DockToPolicyCapability {
  return {
    async observe(
      input: DockToPolicyCapabilityInput,
    ): Promise<CapabilityObservation> {
      let dockPayload: unknown;
      try {
        dockPayload = await gateway.getDock(input.dockId);
      } catch (error) {
        if (error instanceof DockAccessDeniedError) {
          return unavailable('permission_denied', 'Dock access was denied.');
        }
        return unavailable('transport_failure', 'Dock could not be reached.');
      }

      const dock = RawDockSchema.safeParse(dockPayload);
      if (!dock.success || dock.data.id !== input.dockId) {
        return unavailable(
          'schema_failure',
          'Dock returned an unsupported response.',
        );
      }
      if (dock.data.externalRateProviders.length > 0) {
        return unavailable(
          'schema_failure',
          'Dock relies on an external rate provider.',
        );
      }
      const policyId = dock.data.shippingPolicyIds[0];
      if (!policyId) {
        return unavailable(
          'schema_failure',
          'Dock has no associated shipping policy.',
        );
      }

      let policyPayload: unknown;
      try {
        policyPayload = await gateway.getShippingPolicy(policyId);
      } catch (error) {
        if (error instanceof ShippingPolicyAccessDeniedError) {
          return unavailable(
            'permission_denied',
            'Shipping policy access was denied.',
          );
        }
        return unavailable(
          'transport_failure',
          'Shipping policy could not be reached.',
        );
      }

      const policy = RawShippingPolicySchema.safeParse(policyPayload);
      if (!policy.success || policy.data.id !== policyId) {
        return unavailable(
          'schema_failure',
          'Shipping policy returned an unsupported response.',
        );
      }

      return {
        kind: 'success',
        fact: {
          ...input.provenance,
          kind: 'dock-to-policy',
          capability: 'dock-to-policy',
          dockId: input.dockId,
          policyId,
          routeAvailable:
            policy.data.active && policy.data.dockIds.includes(input.dockId),
        },
      };
    },
  };
}
