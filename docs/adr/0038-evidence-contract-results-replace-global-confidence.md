# Evidence Contract Results replace global confidence

The focused product contract does not expose a global `high`, `medium` or `low` confidence value. The Finding Policy evaluates each Evidence Contract as `satisfied`, `insufficient` or `contradicted`, then emits an Investigation Decision with a canonical Decision Reason: `contract_satisfied`, `required_input_missing`, `capability_failed`, `evidence_insufficient`, `evidence_contradictory` or `unsupported_case`. These outcomes state what was verified or blocked instead of presenting an uncalibrated estimate as authority.

## Consequences

The UI shows the decision, reason, relevant Ledger Facts and unmet or contradicted contract conditions. Model self-confidence may be captured separately for experiments or evaluations, but it is not part of the investigation contract, does not affect Finding Policy and is not presented as evidence quality to N2.
