# Order status lifecycle

Orders move through a fixed sequence of statuses. Knowing the current status tells support which actions are still possible.

1. **Order placed**: the customer finished checkout.
2. **Payment pending**: waiting for the payment provider.
3. **Payment approved** or **payment denied**: a denied payment stops the flow and usually leads to cancellation.
4. **Ready for handling**: the seller can start picking and packing.
5. **Handling**: items are being prepared.
6. **Invoiced**: the fiscal invoice was issued and the package handed to the carrier.
7. **Cancelled**: terminal; no further transitions.

## Reading the history

The order's status history lists each transition with a timestamp. Long gaps between two statuses are the first thing to look at when a customer says an order is "stuck". A payment pending for more than the payment window usually expires automatically.

## Limits for support

Support investigations are read-only. Reading the status and history is always allowed; changing a status, cancelling, or reissuing an invoice is an operational action that requires the seller or an authorised specialist.
