# Shipping policies priced by a runtime rate provider

Some docks do not rely on a static freight table. Instead they name a runtime rate provider: an integration that computes coverage and price at checkout time, for example for polygon-based delivery areas, same-day couriers or external carrier quotes.

## What this means for investigations

When a dock names a runtime rate provider, the static freight table does not tell the whole story. An empty freight lookup does not prove the destination is uncovered, because the provider may answer differently at request time. The read-only investigator therefore cannot establish a deterministic route for such docks and must not issue a coverage finding.

## How to proceed

1. Note that the dock uses a runtime rate provider.
2. Check the provider's own status page or logs for errors around the ticket time.
3. Ask the provider team whether the destination is inside their service area.
4. Escalate to a specialist if the provider cannot be checked from support tools.

## Prevention

Document which docks use runtime providers, and keep a static fallback policy for critical regions so checkout still offers a delivery option when the provider is unavailable.
