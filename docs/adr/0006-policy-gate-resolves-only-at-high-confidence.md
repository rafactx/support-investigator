---
status: superseded by ADR-0037
---

# Policy gate resolves only at high confidence; everything else escalates

The original policy gate rules never defined what `confidence: medium` does to `status` — and the most-cited demo case (SKU has stock but no delivery option: one operational evidence from `simulate_fulfillment` + one documental evidence from `search_support_knowledge`) lands exactly on that undefined boundary. We decided the policy gate only auto-resolves (`status: resolved`) at `confidence: high` (2+ consistent evidences); every other case escalates, split by *when* it escalates: `needs_more_data` when the ticket lacks the inputs to even start investigating (no `orderId`/`skuId`/etc.), `needs_human` when the agent investigated but the evidence isn't strong enough to resolve unsupervised (confidence medium or low, a required tool failed, or evidence is inconsistent) — always carrying whatever diagnosis/hypothesis was derivable, not a blank escalation. This makes the agent conservative on purpose — false confidence in a support tool is worse than an extra escalation — and means the flagship demo case ends in an audited escalation with strong evidence, not a silent auto-resolve.
