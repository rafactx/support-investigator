# Official product insights require human-reviewed findings

The Support Investigator may surface automated findings immediately, including findings whose evidence gate reports high confidence, but the CX Intelligence Loop will treat them as Unreviewed Signals until N2 confirms or corrects them. Only Reviewed Findings can support an official Product Insight for Product or Engineering. We accept slower insight coverage in exchange for preventing model or policy-gate errors from becoming authoritative organizational trends.

## Consequences

Human review is part of the first slice's durable record rather than a UI-only acknowledgement. A review is `confirmed`, `corrected` or `inconclusive`; corrections carry the replacement finding, while inconclusive reviews carry a structured Review Reason. The system preserves the automated finding and the review outcome separately, so corrections remain measurable and can improve playbooks and evaluations without rewriting history.
