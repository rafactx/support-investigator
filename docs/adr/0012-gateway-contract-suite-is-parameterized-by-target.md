---
status: accepted
---

# The gateway contract suite is parameterized by target, not literal-shared

`CommerceGateway` implementations must be provably interchangeable, not just independently correct. The shared contract is `describeCommerceGatewayContract` (`src/gateway/commerce-gateway.contract.ts`): it asserts the behaviors the interface's own doc comments promise — a known order carries every field in `EXPECTED_RAW_ORDER_FIELDS`; an unknown order rejects with `OrderNotFoundError` (never `OrderAccessDeniedError`, ADR-0011); a known simulation returns a stocked line with at least one delivery option; an unknown SKU never throws; warehouse, dock, shipping-policy and coverage-zone lookups return the shapes the capabilities chain on.

It is parameterized by a `CommerceGatewayContractTarget` (known/unknown order ids, simulation requests, warehouse/dock/policy ids) rather than hardcoding fixture ids, because a fixture and a real merchant account never share a catalog. `fixture-commerce-gateway.contract.test.ts` supplies fixture literals; a future live adapter's contract test would read a real account's known-good ids from its environment and wrap the suite in `describe.skipIf` gated on credentials *and* those ids together — so a run without them reports `skipped`, never a fake pass. Both `getGateway` and `getTarget` are lazy for exactly that reason: `describe.skipIf` still evaluates its body at collection time.

An earlier iteration of this project shipped such a live adapter against one specific vendor's API, verified only against stubbed `fetch` because no sandbox credentials existed. It was removed when the gateway became fixture-only (ADR-0005); the contract suite is what remains, and it is what a new adapter must pass.
