# Reading a fulfillment simulation result

A fulfillment simulation asks the platform "if this customer bought this SKU, in this quantity, from this seller, delivered to this postal code, what would checkout offer?". It does not create an order and has no side effects.

## Inputs

SKU id, quantity, seller id and destination postal code. All four are required; a missing postal code makes the result meaningless for delivery questions.

## Output

- **items**: availability (available, partial, unavailable), available quantity and price for the SKU.
- **logistics info**: for each item, the list of delivery SLAs with name, channel, price and shipping estimate.

## Interpreting it

| Items | SLAs | Meaning |
| --- | --- | --- |
| available | one or more | Normal; checkout should offer delivery. |
| available | none | Stock without delivery options; investigate the logistics route. |
| unavailable | none | No usable stock, or the SKU is unknown to the seller. |

An unknown SKU does not produce an error: the simulation answers with an unavailable item. Always confirm the SKU id before concluding the item is out of stock.
