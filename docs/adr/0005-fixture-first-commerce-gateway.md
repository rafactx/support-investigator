---
status: accepted
---

# Fixture-first CommerceGateway; a live adapter is a seam, not an assumption

Real commerce-platform sandboxes are rarely self-service: access usually needs a partner agreement or a merchant account, and nobody evaluating this project can be assumed to have one. `CommerceGateway` is therefore an interface whose only shipped implementation is a fixture (`createFixtureCommerceGateway`) serving the Public Reference Scenarios with realistic, self-designed raw payloads — order, inventory, simulation, warehouse, dock, shipping-policy and coverage-zone records (`src/domain/*-record.ts`). This keeps the project reproducible in two commands (`pnpm install && pnpm dev`) with no credentials and no network.

The raw shapes are deliberately provider-shaped (nested, carrying PII and fields the capabilities discard) so the normalization boundary is real: every capability validates its raw payload with Zod and keeps only what its Ledger Fact needs. A live adapter for a real platform only has to implement `CommerceGateway` and pass the shared contract suite (`describeCommerceGatewayContract`, ADR-0012); nothing upstream — capabilities, Finding Policy, Support MCP — changes.
