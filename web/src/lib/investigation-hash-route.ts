// ADR-0041: the Current Investigation's stable, refresh-survivable browser
// location is `#/investigations/:id`, a hash route — never a real path —
// because a real `/investigations/:id` path would collide with the Vite
// dev proxy's own `/investigations` prefix match (`vite.config.ts`).
const ROUTE_PREFIX = '#/investigations/';

/** Reads the Investigation id out of the current hash, or `undefined` when the hash doesn't match this route. */
export function investigationIdFromHash(hash: string): string | undefined {
  if (!hash.startsWith(ROUTE_PREFIX)) {
    return undefined;
  }
  const id = hash.slice(ROUTE_PREFIX.length);
  return id.length > 0 ? decodeURIComponent(id) : undefined;
}

/** The hash to navigate to for a given Investigation id — the inverse of `investigationIdFromHash`. */
export function hashForInvestigation(id: string): string {
  return `${ROUTE_PREFIX}${encodeURIComponent(id)}`;
}
