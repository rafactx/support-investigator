# Support Investigator

An internal, read-only decision-support product for a commerce platform's Product Support (N2) team. Its first bounded use case is the fulfillment investigation where inventory exists but no delivery option is available; it gathers operational and documentary evidence so N2 can act with less manual work and rework.

## Language

**Support Investigator**:
The internal decision-support product N2 uses to investigate recurring operational problems. It is not customer-facing and does not itself change or close a support ticket.
_Avoid_: public support bot, ticket resolver

**Fulfillment Investigation**:
The first supported investigation kind: determining why an item with available inventory has no delivery option for a given seller and destination. It is the initial vertical slice, not a synonym for every Product Support investigation.
_Avoid_: generic support investigation, delivery bot

**Fulfillment Playbook**:
The deterministic investigation path for the first Fulfillment Investigation, including its required evidence checks and Finding Policy evaluation. AI assists with ambiguous language and explanation but does not control mandatory checks.
_Avoid_: generic agent loop, autonomous support agent

**Investigation Intake**:
The validated, structured inputs required to begin one investigation. Every field records whether it was supplied by the user or proposed by Language Assistance; model-proposed identifiers remain unconfirmed and cannot start Operational Capabilities until N2 confirms them. Account Scope must come from explicit trusted context rather than unstructured support text. Missing, ambiguous or unconfirmed required values produce `needs_input`; model-proposed values are not evidence.
_Avoid_: ticket summary, model evidence, guessed identifiers

**Language Assistance**:
The bounded, degradable use of AI to propose an Investigation Intake from unstructured support text or, on explicit request, improve a deterministic Finding explanation from the Evidence Ledger. Structured intake and Source Pack explanations remain available when AI is unavailable; Language Assistance has no authority to create Ledger Facts or assign a Finding Code.
_Avoid_: autonomous agent, Finding Policy, model diagnosis, availability dependency

**Operational Capability**:
A governed, read-only operation that obtains one kind of account-scoped evidence and normalizes it into Ledger Facts. First-party playbooks use capabilities directly; adapters may expose the same capabilities to other consumers.
_Avoid_: model tool, raw platform API response, MCP-only operation

**Symptom Code**:
A canonical label for the observable failure that started an investigation, independent of its cause. `STOCK_WITHOUT_DELIVERY_OPTIONS` is the first supported Symptom Code.
_Avoid_: diagnosis, root cause, hypothesis

**Finding Code**:
A canonical project label for the cause established by an investigation and its evidence. It is the stable identity used for review and aggregation, but it is not presented as a diagnosis authored or endorsed by any platform vendor.
_Avoid_: free-text hypothesis, Symptom Code, official vendor diagnosis

**Evidence Ledger**:
The auditable collection of Ledger Facts gathered during an investigation, each traceable to the capability call and result that produced it. Model-authored summaries are explanations of ledger facts, not ledger facts themselves.
_Avoid_: agent transcript, model-proposed evidence list

**Ledger Fact**:
A typed, versioned and immutable observation in an Evidence Ledger. Its kind determines the domain data it carries, while a common envelope preserves investigation identity and provenance.
_Avoid_: evidence string, arbitrary JSON payload, mutable snapshot

**Investigation Audit Trail**:
The immutable chronology of accepted Investigation Intake changes, Ledger Facts, policy decisions, generated explanations and Human Reviews for one investigation. Later corrections add history instead of replacing what the system or N2 previously concluded.
_Avoid_: current investigation view, application log, full event-sourced application

**Current Investigation**:
The latest operational view of an investigation, including its present finding and review state. It is derived from the Investigation Audit Trail for efficient product use and is not itself the historical record.
_Avoid_: audit trail, source of truth for history

**Investigation State**:
The durable lifecycle position of an investigation. The synchronous slice exposes `awaiting_input`, `completed` and `failed`: `awaiting_input` means required intake is missing, ambiguous or contains unconfirmed model proposals; `completed` means the playbook produced an auditable decision, including a specialist-review decision after a capability failure; `failed` is reserved for a technical failure that prevented any auditable decision. `queued` and `running` enter the vocabulary with the later asynchronous worker. Human Review status is derived from reviews and is not an Investigation State.
_Avoid_: Status, Finding Code, ticket status

**Investigation Progress**:
The current user-facing phase within a running investigation, such as gathering inventory, simulating fulfillment, checking the logistics route or evaluating evidence. It may change frequently and never determines a finding.
_Avoid_: token stream, chain of thought, Investigation State

**Evidence Provenance**:
The identity and observation context that make one Evidence Ledger fact traceable to its originating capability result. It belongs with the fact throughout review and audit.
_Avoid_: citation alone, model explanation

**Public Reference Scenario**:
A reproducible investigation scenario whose domain rules, self-designed payload shapes and expected evidence are documented in this repository (fixtures, support runbooks, ADRs). Its identifiers and case composition are synthetic, so it is neither a vendor-published dataset nor live merchant evidence.
_Avoid_: official dataset, live merchant case, arbitrary mock

**Raw Evidence Payload**:
The unnormalized response returned by an operational capability, which may contain customer or order data beyond what the investigation needs. Unstructured support-ticket text receives the same transient treatment. Neither is persisted or logged in this slice; only privacy-allowlisted structured values and normalized facts become durable.
_Avoid_: Evidence Ledger, permanent audit record

**Evidence Contract**:
The required and disqualifying Evidence Ledger facts for assigning one specific Finding Code. An unmet or contradicted contract cannot yield that code.
_Avoid_: prompt instruction, confidence threshold

**Evidence Contract Result**:
The objective evaluation of one Evidence Contract as `satisfied`, `insufficient` or `contradicted`. It describes evidence sufficiency without estimating model confidence.
_Avoid_: high confidence, probability, model score

**Finding Policy**:
The Support Investigator's deterministic authority that evaluates Evidence Contracts against an Evidence Ledger and assigns the final Finding Code. Its rules interpret combinations of observed facts, and they are explicit, versioned project decisions.
_Avoid_: model classification, agent judgment, vendor policy

**ROOT_CAUSE_UNDETERMINED**:
The Finding Code used when the symptom is verified but available evidence does not establish one supported cause. It preserves uncertainty rather than promoting a hypothesis to a finding.
_Avoid_: unknown error, best guess

**DESTINATION_NOT_COVERED**:
The first supported Finding Code for `STOCK_WITHOUT_DELIVERY_OPTIONS`: inventory and the warehouse-to-dock-to-policy route are valid, but no applicable shipping-policy coverage includes the requested destination. Zero delivery options or documentary guidance alone is insufficient to assign this code.
_Avoid_: no delivery option, shipping problem, vendor diagnosis

**Finding Source Pack**:
The versioned set of support runbook references selected for one supported Finding Code. It grounds explanations and recommended human actions, but it is not case evidence and cannot satisfy an Evidence Contract.
_Avoid_: Evidence Ledger, live documentation search, RAG result

**Support MCP**:
The internal, governed capability interface through which support automations obtain normalized, read-only operational evidence. It is an internal platform seam, not a public integration product or a documentation source.
_Avoid_: "the MCP server", "the agent's MCP", documentation MCP

**CX Platform MCP**:
A permissioned, external source of customer-support interactions and aggregate service analytics. It contributes organizational context to the insight loop; it is not evidence for deciding an individual Fulfillment Investigation.
_Avoid_: Support MCP, case evidence source

**CX Intelligence Loop**:
The required second product slice that relates reviewed Support Investigator findings to customer-support patterns such as recurrence, transfers and satisfaction. It informs Product and Engineering without participating in the decision path of an individual investigation.
_Avoid_: optional analytics dashboard, investigation runtime

**Account Scope**:
The merchant organization whose operational context an investigation concerns. It identifies where evidence belongs but never represents credentials or permission to access that organization.
_Avoid_: account credentials, authenticated user, global account

**Support Case Reference**:
An optional, opaque reference back to the support record from which an investigation originated. It identifies the source record without making its text or customer identity part of that reference.
_Avoid_: ticket text, customer email, conversation transcript

**CX Correlation**:
An explicit, authorized link between a Support Case Reference and a CX Platform conversation. Without that link, the CX Intelligence Loop uses aggregate patterns only and never presents a probable match as the same case.
_Avoid_: inferred conversation match, text-based join, temporal guess

**Unreviewed Signal**:
An automated investigation finding that N2 has not yet confirmed, corrected or marked inconclusive. It may indicate emerging workload, but it is not trusted evidence for an official Product Insight.
_Avoid_: validated diagnosis, confirmed finding

**Human Review**:
N2's evaluation of an Unreviewed Signal as `confirmed`, `corrected` or `inconclusive`. Confirmation and correction remain within the supported Finding taxonomy; a cause outside the playbook is recorded as inconclusive rather than becoming a free-text Finding. In the demo, a short reviewer name is declared and stored as attribution, not as authenticated identity.
_Avoid_: approval, thumbs-up, model validation, free-text Finding creation

**Review Reason**:
A structured explanation for why a Human Review corrected a Finding or remained inconclusive, such as missing evidence, blocked access, conflicting evidence or `outside_supported_playbook`. It makes uncertainty and taxonomy gaps analyzable without promoting reviewer notes into canonical Findings.
_Avoid_: mandatory review comment, rejection note

**Reviewed Finding**:
An investigation finding that N2 has explicitly confirmed or corrected. It is the only kind of Support Investigator finding that can support an official Product Insight.
_Avoid_: high-confidence diagnosis, model-approved finding

**Product Insight**:
An auditable claim for Product or Engineering that relates one or more Reviewed Findings to operational impact or authorized CX context. It is distinct from an Unreviewed Signal and from a single-case diagnosis.
_Avoid_: raw agent analytics, unreviewed trend, investigation result

**Investigation Decision**:
The Finding Policy's auditable disposition after evaluating available evidence: `ready_for_human_resolution`, `needs_input` or `requires_specialist_review`. It describes what N2 can do next and never claims that a support ticket was closed.
_Avoid_: Status, resolved, ticket outcome

**Decision Reason**:
The canonical reason an Investigation Decision was selected, such as a satisfied contract, missing required input, capability failure, insufficient or contradictory evidence, or an unsupported case. It makes the decision explainable and aggregable without a confidence score.
_Avoid_: confidence level, free-text rationale

**Ticket Status**:
The support system's record of the ticket lifecycle, owned outside the Support Investigator. An Investigation Decision may inform a human action on the ticket but never changes this status itself.
_Avoid_: Investigation State, Investigation Decision

**Delivery Option**:
One way the platform can deliver a SKU to a destination, as `simulate_fulfillment` returns it — an entry in `deliveryOptions[]` carrying its own `id`, `channel`, `priceCents` and `transitBusinessDays`.
_Avoid_: SLA (ambiguous with service-level agreement)

**NO_DELIVERY_OPTIONS**:
A `simulate_fulfillment` message meaning the SKU has stock (`availableQuantity > 0`) but zero `deliveryOptions[]` for the given seller/postal code — the flagship demo case named in `ADR-0006` ("the SKU has stock but no delivery option shows up"). Distinct from an out-of-stock SKU (`availableQuantity: 0`), which is a different, unrelated failure mode and does not produce this message.

**Knowledge Index**:
The versioned documentary search artifact built from the Curated doc set. It supports exploratory retrieval and optional language assistance, but never creates Ledger Facts, satisfies Evidence Contracts or selects the normative Finding Source Pack.
_Avoid_: Evidence Ledger, Finding Source Pack, source of case evidence

**Curated doc set**:
The fixed, reviewable collection of original support runbooks (`src/kb/articles/`) from which documentary artifacts are built. Inclusion is an explicit project decision rather than whatever a live search ranks first.

**Eval report** _(retired)_:
Historical term for the on-disk artifact the old golden-ticket harness wrote for the generic, model-driven `/investigate` contract. That harness, the route it measured and the reports were removed (`docs/adr/0046`): the Fulfillment Playbook's determinism is proven by ordinary Public Reference Scenario tests (`pnpm test`), and model behavior at the intake boundary by `pnpm evals:intake`.
_Avoid_: using this term for anything current — the artifact no longer exists
