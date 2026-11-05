import { z } from 'zod';
import type { CommerceGateway } from '../gateway/commerce-gateway.ts';
import { CoverageZonesAccessDeniedError } from '../gateway/commerce-gateway.ts';
import type {
  DestinationCoverageCapability,
  DestinationCoverageCapabilityInput,
} from './types.ts';

const RawCoverageZoneSchema = z.object({
  postalCodeFrom: z.string(),
  postalCodeTo: z.string(),
  geofenceId: z.string().nullable(),
});
const RawCoverageZonesSchema = z.array(RawCoverageZoneSchema);

/**
 * Turns a policy's coverage zones for a postal code into the destination-
 * coverage fact. The endpoint is already postal-code-scoped, so whether the
 * destination is covered is the provider's own determination: an empty
 * response means uncovered, at least one matching zone means covered.
 * This capability does not re-derive coverage from `postalCodeFrom`/
 * `postalCodeTo`/`geofenceId` — see `coverage-record.ts`.
 */
export function createDestinationCoverageCapability(
  gateway: CommerceGateway,
): DestinationCoverageCapability {
  return {
    async observe(input: DestinationCoverageCapabilityInput) {
      let payload: unknown;
      try {
        payload = await gateway.getCoverageZones(
          input.policyId,
          input.destinationPostalCode,
        );
      } catch (error) {
        if (error instanceof CoverageZonesAccessDeniedError) {
          return {
            kind: 'unavailable' as const,
            failure: {
              kind: 'permission_denied',
              capability: 'destination-coverage',
              message: 'Coverage zones access was denied.',
            },
          };
        }
        return {
          kind: 'unavailable' as const,
          failure: {
            kind: 'transport_failure',
            capability: 'destination-coverage',
            message: 'Coverage zones could not be reached.',
          },
        };
      }

      const parsed = RawCoverageZonesSchema.safeParse(payload);
      if (!parsed.success) {
        return {
          kind: 'unavailable' as const,
          failure: {
            kind: 'schema_failure',
            capability: 'destination-coverage',
            message: 'Coverage zones returned an unsupported response.',
          },
        };
      }

      return {
        kind: 'success' as const,
        fact: {
          ...input.provenance,
          kind: 'destination-coverage',
          capability: 'destination-coverage',
          policyId: input.policyId,
          destinationPostalCode: input.destinationPostalCode,
          covered: parsed.data.length > 0,
        },
      };
    },
  };
}
