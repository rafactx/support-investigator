# Finding gaps in freight table postal-code ranges

Freight tables are maintained as postal-code ranges, often imported from a carrier spreadsheet. Gaps appear when ranges are trimmed, when a carrier stops serving a region, or when two imports overlap and one is deleted.

## Typical signs

- A single neighbourhood or city fails while the surrounding region works.
- Failures started right after a freight table import.
- The same SKU ships fine to a nearby postal code through the same dock.

## How to locate the gap

1. Export the policy's freight table and sort the rows by range start.
2. Walk the rows and look for an end value followed by a start value that is more than one postal code away.
3. Compare the gap with the destinations reported in tickets.
4. Check whether a polygon entry was meant to cover the area instead of a numeric range.

## Fixing it

Add a range that closes the gap, with the carrier's price and transit time for that area. If the carrier genuinely does not serve the region, document it as an intentional exclusion so future tickets can be answered quickly. Keep a copy of the table before every import so a regression can be compared row by row.
