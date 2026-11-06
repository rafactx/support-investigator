---
status: accepted
---

# The `POST /investigations` idempotency fingerprint hashes ticket text, never stores it raw

The original `fingerprint()` was a fixed positional tuple over the five structured create fields, and `requestFingerprint` is stored durably in the in-memory repository's `idempotencyIndex` for the lifetime of the process (a DynamoDB-backed repository would persist it for longer still). Intake from ticket text adds an optional `ticketText` field to the same request. Leaving it out of the fingerprint tuple would make two creates that differ only in ticket text hash identically — the second would be silently treated as an exact retry of the first and never reach `buildIntake`/Language Assistance at all, breaking the idempotency contract for the one field this change actually adds. Putting the raw ticket text into the tuple would satisfy idempotency but durably store exactly the raw ticket text that must never be persisted or logged, in a second place its own author might not think to check.

`fingerprint()` instead extends its tuple with `ticketTextDigest(ticketText)` — a SHA-256 hash of the trimmed, lowercased text (`null` when `ticketText` is absent). The digest still distinguishes "the same ticket text resubmitted" from "different ticket text under the same `Idempotency-Key`", because two texts that normalize to the same string hash identically and two that don't, don't — the property idempotency needs — without the durable idempotency record ever holding recoverable ticket content.

## Consequences

A SHA-256 digest is a one-way function, not encryption: this ADR does not claim the digest is unlinkable from the original text under a chosen-plaintext attack (an attacker who already knows a candidate ticket text can confirm a match), only that the stored value cannot be reversed to recover unknown ticket content — which is what the "neither persisted nor logged" rule is actually protecting against. `PATCH /investigations/:id/intake`'s own fingerprint (`patchIntakeFingerprint`) needed no equivalent treatment: that route's request body never carries ticket text at all, only structured corrections/confirmations and `expectedRevision`.
