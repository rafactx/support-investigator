# Destination postal code not covered by the shipping policy

## Symptom

Stock is available and the warehouse-to-dock-to-policy route is valid, yet the fulfillment simulation returns no delivery SLA for one specific postal code. Nearby postal codes may work normally.

## How coverage works

Every shipping policy owns a freight table: a list of postal-code ranges (or geographic polygons) with prices and transit times. When the platform prices a delivery it looks up the destination postal code in that table. If no row matches, the policy simply does not serve that destination, and the platform has nothing to offer at checkout.

## How to confirm

1. Identify the shipping policy the dock ships through.
2. Query the freight values for that policy and the destination postal code. An empty result means the destination is not covered.
3. Check that the postal code is written in the platform's canonical format; a missing hyphen or leading zero can fall outside every range.

## Recommended action

Extend the policy's freight table so a range includes the destination, or route the order through another policy that already covers it. Coverage changes are configuration work for the logistics team; support should not edit freight tables while investigating. After the change, rerun the fulfillment simulation to verify a delivery SLA appears.
