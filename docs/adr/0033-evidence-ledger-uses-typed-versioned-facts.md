# The Evidence Ledger uses typed, versioned facts

The Evidence Ledger is a discriminated union of immutable domain facts rather than strings or arbitrary JSON. Each Ledger Fact has a shared provenance envelope and a versioned type-specific body, initially covering inventory, fulfillment simulation, warehouse-to-dock relationships, dock-to-policy relationships and destination coverage. Operational adapters normalize external payloads into these facts at the seam, so Finding Policies never parse provider responses or model prose.

Fact kinds are introduced by active Evidence Contracts, not by plausible future diagnoses. Shipping-rate, seller-context and other facts remain deferred until a supported Finding requires them.

## Consequences

Fact schemas and policy versions evolve independently and unknown fact kinds or unsupported versions fail closed instead of being guessed. Contract tests exercise the Finding Policy through typed ledgers without MCP, LLM or network dependencies. Schema evolution requires explicit upcasters or migrations; it cannot silently reinterpret already reviewed evidence.
