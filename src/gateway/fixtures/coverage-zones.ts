import type { RawCoverageZone } from '../../domain/coverage-record.ts';

function coverageKey(policyId: string, postalCode: string): string {
  return `${policyId}:${postalCode}`;
}

/**
 * Public Reference Scenarios for the coverage-zone lookup, keyed by
 * `policyId:postalCode`:
 *
 * - `POLICY-1` / `01310-100`: empty — the destination is not covered, the
 *   negative condition `DESTINATION_NOT_COVERED` requires.
 * - `POLICY-1` / `04000-000`: one matching zone — a covered destination
 *   that contradicts the Finding.
 *
 * Any `policyId`/`postalCode` combination not listed here falls back to an
 * empty array in `fixture-commerce-gateway.ts`, matching the lookup's behavior
 * for a postal code no zone covers.
 */
export const FIXTURE_COVERAGE_ZONES: Record<string, RawCoverageZone[]> = {
  [coverageKey('POLICY-1', '01310-100')]: [],
  [coverageKey('POLICY-1', '04000-000')]: [
    { postalCodeFrom: '04000-000', postalCodeTo: '04999-999', geofenceId: null },
  ],
};

export { coverageKey };
