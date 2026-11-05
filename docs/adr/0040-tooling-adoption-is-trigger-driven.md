---
status: accepted
---

# Tooling adoption is trigger-driven

AI SDK Core with the Amazon Bedrock provider is the only LLM abstraction in the focused slice, and it is limited to bounded language-heavy work around the deterministic Fulfillment Playbook. MCP TypeScript SDK v2 with Hono is adopted in an independent final milestone for the external capability adapter. The synchronous slice uses privacy-allowlisted structured logs; Lambda Powertools and OpenTelemetry/ADOT are deferred until the asynchronous worker creates concrete idempotency, batch-handling, metrics and tracing responsibilities. Additional agent, workflow, retrieval and LLM-observability runtimes are deferred rather than rejected; each may enter only when an observed requirement matches its adoption trigger and it replaces an owned responsibility instead of duplicating one.

## Deferred options and adoption triggers

| Option | Reconsider when |
| --- | --- |
| LangGraph.js | An investigation becomes a genuinely long-running, branching and checkpointed graph with human suspension that the persisted Investigation State and idempotent SQS worker cannot express cleanly. |
| Mastra | The product explicitly chooses a framework-owned agent, workflow, memory and studio runtime, and is prepared to replace overlapping application and AWS responsibilities rather than run both. |
| AI SDK Workflow | A bounded worker can no longer recover safely through queue retry, idempotent capability execution and persisted state. AI SDK Core remains usable without its workflow runtime. |
| Amazon Bedrock AgentCore Harness | A separate autonomous loop needs configuration-owned Strands orchestration, isolated stateful sessions, shell/filesystem, managed skills or per-session memory. The deterministic first-party playbook does not. |
| Amazon Bedrock AgentCore Runtime | A proven workload needs a custom ARM64 container/protocol, long-running isolated sessions or execution characteristics Lambda cannot provide economically or safely. |
| Amazon Bedrock AgentCore Gateway or Registry | Multiple teams need an organization-wide governed tool/MCP catalog, centralized agent identity, discovery, approval or policy enforcement beyond the bounded Support MCP deployment. |
| Amazon Bedrock AgentCore Evaluations | Production OpenTelemetry traces need online/on-demand LLM-as-judge evaluation beyond deterministic domain tests and the offline golden set. |
| Langfuse | CloudWatch and the existing evaluation reports no longer provide enough generation-level diagnosis or experiment analysis, and data residency, PII masking, retention and cost are approved. OpenTelemetry compatibility must be preserved so adoption does not rewrite the domain. |
| Bedrock Knowledge Bases | Retrieval benchmarks, corpus scale, refresh frequency or document-level authorization show that the versioned curated index is the limiting component. |
| Lambda Powertools and OpenTelemetry/ADOT | The asynchronous SQS worker introduces batch failure handling, production-relevant idempotency, cross-invocation metrics and traces that structured synchronous logs cannot express adequately. |
| Step Functions, Temporal or Inngest | Observed duration, branching, compensation or operator recovery requirements cannot be represented clearly by the current asynchronous investigation resource and queue worker. |
| An autonomous Strands tool loop | A separate exploratory mode is intentionally introduced. Its results remain Unreviewed Signals and cannot skip Evidence Contracts, assign official Findings or alter Investigation Decisions. |

## Consequences

“Deferred” is not permanent rejection, but project growth alone is not an adoption trigger. A future proposal must identify the measured constraint, the responsibility the tool will take over, the component it replaces, the migration boundary and how the Evidence Ledger, Finding Policy and Human Review survive removal of that tool. The first slice removes Strands from its critical path instead of combining it with AI SDK, and no second orchestration runtime is added speculatively.

The supporting comparison and migration sequence are recorded in [AI SDK and tooling recommendation](../research/2026-07-30-ai-sdk-and-tooling-recommendation.md).
