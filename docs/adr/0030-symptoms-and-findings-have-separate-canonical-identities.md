# Symptoms and findings have separate canonical identities

An investigation records what was observed as a Symptom Code and what the evidence established as a separate Finding Code. Natural-language hypotheses remain useful explanations, but they are not identities for review, evaluation or aggregation; exact-string grouping would fragment the same cause and allow model wording to redefine the taxonomy at runtime. A specific Finding Code requires supporting operational evidence, otherwise the result is `ROOT_CAUSE_UNDETERMINED`.

## Initial fulfillment taxonomy

The first Symptom Code is `STOCK_WITHOUT_DELIVERY_OPTIONS`. The first slice supports exactly one positive Finding Code, `DESTINATION_NOT_COVERED`, plus the safe fallback `ROOT_CAUSE_UNDETERMINED`.

`DESTINATION_NOT_COVERED` requires call-bound evidence that inventory is available, the warehouse-to-dock-to-policy route is valid and no applicable shipping-policy coverage includes the requested destination. Zero delivery options or documentary guidance alone cannot satisfy the contract.

Other plausible causes—including unavailable channel inventory, broken warehouse/dock/policy relationships, inapplicable shipping rates and seller-context mismatches—remain candidate future Findings rather than active taxonomy. Each requires its own public-source grounding, Evidence Contract and adversarial evaluation before adoption.

## Consequences

The current insight report's exact-string grouping of `diagnosis.hypothesis` is not the future Product Insight identity and must be replaced when the focused slice is implemented. Explanations may change without splitting metrics; changing a canonical code requires an explicit taxonomy migration. The previous broad list is deliberately not implemented speculatively: unsupported cases fail closed as `ROOT_CAUSE_UNDETERMINED`.
