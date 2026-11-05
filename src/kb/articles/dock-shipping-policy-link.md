# Linking loading docks to shipping policies

A route from a dock to a shipping policy exists only when both sides agree:

- the dock lists the policy's freight table among its freight table ids, and
- the policy lists the dock among its linked docks.

## Why both sides matter

Dock and policy records are edited independently. A dock can keep a stale freight table id after a policy is deleted or recreated, and a policy can be linked to a dock that was later reconfigured. Trusting only one side can make a route look valid when the platform will not use it.

## How to verify

1. Read the dock: is it active, and which freight table ids does it list?
2. For each id, read the shipping policy: is it active, and does it list this dock back?
3. A dock with no active, mutually linked policy has no route.

## Common mistakes

- Policy deactivated for maintenance and never reactivated.
- Policy cloned to create a new carrier contract, but the dock still points at the old one.
- Dock linked to a policy from a different seller account.

Fix by relinking the dock and policy on both sides, then rerun a fulfillment simulation.
