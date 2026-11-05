# Product in stock but no delivery options at checkout

## Symptom

A shopper adds a SKU to the cart, the product page shows it as available, but checkout offers no shipping method for their address. Support tickets usually read "the item has stock but no delivery option shows up" or "frete indisponível".

## Why it happens

Availability and deliverability are decided by different parts of the platform. Inventory only answers "is there usable quantity in some warehouse?". A delivery option additionally needs a complete logistics route: the warehouse holding the stock must be mapped to a loading dock, the dock must ship through an active shipping policy, and that policy's freight table must cover the destination postal code. If any link is missing, the fulfillment simulation returns the item as available with an empty list of delivery SLAs.

## How to investigate

1. Confirm usable stock: quantity minus reserved quantity must cover the requested amount in at least one warehouse.
2. Run a fulfillment simulation for the SKU, quantity, seller and destination postal code. Zero SLAs with available stock reproduces the symptom.
3. Walk the route: warehouse to dock, dock to shipping policy, and finally the policy's freight coverage for the postal code.
4. Record each step as evidence. Do not conclude from the ticket text alone.

## Resolution

The most common root cause is a destination outside the policy's freight coverage; see "Destination postal code not covered by the shipping policy". Other causes are an unmapped warehouse, an inactive dock, or a policy that does not link back to the dock.
