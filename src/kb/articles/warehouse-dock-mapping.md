# Mapping warehouses to loading docks

A warehouse holds inventory; a loading dock is where shipments leave. The platform only creates delivery options for stock in a warehouse that is linked to at least one active dock.

## What to check

- The warehouse record is active.
- The warehouse lists one or more docks in its dock mapping.
- Each mapped dock is itself active.

A warehouse with stock but no dock mapping produces "available" items with no delivery option. This often happens when a new warehouse is created and stock is loaded before logistics finishes the configuration.

## Several docks per warehouse

When a warehouse maps to more than one dock, a platform may rank the docks by processing time, cost overhead or a manual priority. The investigator does not reproduce that ranking: it follows the first dock the warehouse reports and treats the route as observed only for that dock. If the ticket concerns a specific dock, confirm it separately.

## Fix

Ask the logistics team to link the warehouse to a dock that ships through the right shipping policy. Do not move inventory to another warehouse as a workaround; it hides the configuration gap.
