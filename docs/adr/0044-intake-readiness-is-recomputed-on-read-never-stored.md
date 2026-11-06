---
status: accepted
---

# Intake readiness (and its gaps) is recomputed on every read, never persisted as its own field

`awaiting_input` (ADR-0036's vocabulary, first implemented with intake from ticket text) needs to answer two related questions on every `GET /investigations/:id`: is this Investigation ready for the Fulfillment Playbook, and if not, which fields are missing or unconfirmed and why. The event-sourced write side (`investigation_created`/`intake_updated`, ADR-0034) already has one authoritative fact per Investigation — its current `FulfillmentIntake` — and `evaluateIntakeReadiness(investigationId, intake)` (`src/domain/investigation.ts`) is a pure, total function from that intake to either a ready `ConfirmedFulfillmentIntake` or a list of `IntakeGap`s.

Storing readiness or its gaps as their own field on the `Investigation` projection (or worse, on the event itself) would create a second value that has to agree with `intake` on every write path — `POST /investigations`, `PATCH /investigations/:id/intake`'s two branches, and any future write path not yet written — with no type-level enforcement that they do. `toInvestigationResponse` (`src/api/investigations-app.ts`) instead calls `evaluateIntakeReadiness` itself, every time it serializes a response, and derives `intakeGaps` from the result. The same function also gates whether the Fulfillment Playbook runs at all, in both `POST /investigations` and `PATCH /investigations/:id/intake` — the read path and the write path's control-flow decision share the exact same computation, not two independently-maintained copies of "is this ready".

## Consequences

`intakeGaps` in `InvestigationResponse` can never drift from `state`/`intake` the way a stored, independently-updated field could — a bug that forgets to update one still cannot produce a response where `state: 'completed'` carries a non-empty `intakeGaps`, because both are read from the same intake in the same call. The cost is a small amount of repeated computation (linear in the four required fields) on every read; at this slice's scale that is not a real cost, and revisiting it — memoizing or storing readiness — would only be justified if `evaluateIntakeReadiness` itself grew expensive, which nothing in this domain currently suggests.
