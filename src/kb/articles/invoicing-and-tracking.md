# Invoicing and shipment tracking

## Invoicing

An order is invoiced when the seller issues the fiscal invoice and attaches it to the order's package. The package then carries the invoice number and value. Invoicing is usually the moment the order leaves the seller's hands and is collected by the carrier.

Common invoicing problems:

- invoice value different from the order total because of a partial shipment;
- invoice attached to the wrong package in a multi-package order;
- order stuck in handling because the seller's ERP integration failed to post the invoice.

## Tracking

After invoicing, the carrier's tracking events are attached to the package. A courier status marked as finished means the carrier reported delivery.

## Investigating "where is my order?"

1. Confirm the order is invoiced; before that there is nothing to track.
2. Check the package's courier status and the date of the last event.
3. If tracking has been silent for longer than the promised shipping estimate, contact the carrier through the seller.
