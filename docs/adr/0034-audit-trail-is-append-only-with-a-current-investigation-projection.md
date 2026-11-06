---
status: accepted
---

# The audit trail is append-only with a Current Investigation projection

Accepted Investigation Intake changes, Ledger Facts, policy decisions, generated explanations and Human Reviews form an append-only Investigation Audit Trail; a correction records a new review and never overwrites the automated finding or an earlier human decision. Product reads use a materialized Current Investigation projection so normal workflows do not replay history on every request. We deliberately do not event-source the entire application: immutable history is valuable for evidence, decisions and learning, not for transient UI state or every technical interaction.

## Consequences

The Current Investigation can be rebuilt from its audit trail and updated idempotently as new records arrive. Create, intake-update, explanation and review commands carry idempotency identity where retries can repeat a write, and mutable-resource commands check the expected projection revision. Audit records remain immutable except for privacy or legal deletion workflows. Tests cover both projection updates and replay from the same history.
