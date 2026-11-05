# Reserved, available and unlimited inventory

Each warehouse reports three numbers for a SKU:

- **quantity**: units physically recorded in the warehouse.
- **reserved quantity**: units held by orders that are placed but not yet shipped.
- **unlimited quantity flag**: the SKU is made to order or dropshipped and never runs out.

## Usable stock

Usable stock is quantity minus reserved quantity, unless the unlimited flag is set. A SKU with quantity 10 and reserved 10 shows stock in back-office screens but is not sellable. Many "stock is there but I cannot buy it" tickets are reservations, not logistics problems.

## Investigation tips

- Compare the requested quantity with usable stock in each warehouse, not the total across warehouses. An order is fulfilled from one warehouse route at a time.
- Reservations normally release when an order is cancelled or after the payment window expires. Long-lived reservations point to stuck orders.
- An inventory read that is denied is a permission problem; see "Read access denied during an investigation".

## Fix

If reservations are stale, cancel or progress the stuck orders. If stock is genuinely exhausted, restock or set expectations with the customer.
