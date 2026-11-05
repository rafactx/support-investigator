/**
 * The read-only subset of the commerce platform's coverage-zone record
 * needed to decide postal-code coverage: the lookup is keyed by shipping
 * policy and postal code, and answers with an empty array for an uncovered
 * postal code and one or more matching zones for a covered one —
 * applicability is the provider's own determination, already resolved
 * server-side for the requested postal code.
 */
export interface RawCoverageZone {
  postalCodeFrom: string;
  postalCodeTo: string;
  /** Geofence id when the zone is a drawn area rather than a plain postal-code range; `null` otherwise. */
  geofenceId: string | null;
}
