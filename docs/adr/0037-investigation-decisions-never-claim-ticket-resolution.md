---
status: accepted
---

# Investigation Decisions never claim ticket resolution

The Support Investigator emits an Investigation Decision of `ready_for_human_resolution`, `needs_input` or `requires_specialist_review`; it no longer uses `resolved`, `needs_more_data` or `needs_human` as its product verdict. `ready_for_human_resolution` means the Evidence Contract is satisfied and N2 has an auditable recommendation, not that the ticket was changed or closed. Missing required case data yields `needs_input`, while failed capabilities, contradictory evidence or `ROOT_CAUSE_UNDETERMINED` yield `requires_specialist_review`.

## Consequences

Investigation Decision, Investigation State, Human Review and Ticket Status remain separate fields with separate owners. The current `Status` schema, count-derived confidence gate and `{ proposed, final }` wire contract are migration targets rather than the focused product contract; model explanations remain auditable in the Investigation Audit Trail without granting the model authority over classification or disposition.
