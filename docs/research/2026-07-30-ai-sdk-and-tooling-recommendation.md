# AI SDK and tooling recommendation

**Date:** 2026-07-30  
**Scope:** focused Fulfillment Investigator, designed to grow into an internal support-investigation platform

The resulting adoption decision and explicit reconsideration triggers are accepted in [ADR-0040](../adr/0040-tooling-adoption-is-trigger-driven.md).

## Version verification

Read-only npm registry queries on 2026-07-30 returned:

| Package | Current stable |
| --- | --- |
| `ai` | `7.0.42` |
| `@ai-sdk/amazon-bedrock` | `5.0.36` |
| `@modelcontextprotocol/server` | `2.0.0` |
| `@modelcontextprotocol/hono` | `2.0.0` |

The AI SDK v7 migration guide requires Node.js 22+ and ESM, both compatible with this repository's target runtime. MCP's official v2 documentation identifies v2 as the stable release line for the 2026-07-28 protocol and provides a v1 codemod plus an official Hono adapter. Pin exact versions during migration and upgrade only behind model, transport and contract tests.

## Executive recommendation

Use AI SDK, but only as the model-integration layer. Do not replace the domain workflow with an AI SDK agent loop, Strands, LangGraph, Mastra, or Bedrock AgentCore.

The first production slice should have one deterministic Fulfillment Playbook that calls typed Operational Capabilities, appends facts to the Evidence Ledger, and invokes the Finding Policy. AI is allowed only at language-heavy boundaries: extracting ambiguous intake, retrieving optional explanatory knowledge, and drafting a grounded explanation or next action.

The target stack is:

```text
TypeScript + Zod
        │
        ├── deterministic Fulfillment Playbook
        │       ├── Operational Capabilities
        │       ├── Evidence Ledger
        │       └── Finding Policy
        │
        ├── AI SDK Core + Amazon Bedrock provider
        │       └── bounded extraction and explanation
        │
        ├── MCP TypeScript SDK v2 + Hono adapter
        │       └── external AI consumers only
        │
        └── AWS Lambda + SQS + DynamoDB + EventBridge
                ├── Lambda Powertools
                └── OpenTelemetry/ADOT
```

This is deliberately a small stack. “World-class” here means each dependency owns one clear problem and can be replaced without rewriting the domain.

## Adopt now

| Concern | Choice | Why it belongs |
| --- | --- | --- |
| Domain contracts | TypeScript + Zod | One schema vocabulary can validate API input, capability input/output, MCP tools, Evidence Facts, and constrained model output. |
| Model integration | `ai` v7 + `@ai-sdk/amazon-bedrock` | AI SDK Core provides a unified model API, `generateText`, schema-constrained `Output.object`, tool primitives when needed, and OpenTelemetry integration. It removes provider-specific orchestration without forcing an agent loop. |
| Model provider | Amazon Bedrock | It matches the AWS production boundary and IAM operating model. Keep one configured production provider and fake deterministic models for tests. Provider portability is an escape hatch, not a reason to run multiple providers in production. |
| MCP server | `@modelcontextprotocol/server` v2 + `@modelcontextprotocol/hono` v2 | The v2 SDK is the stable line for the 2026-07-28 protocol and has an official Hono integration. It should replace the monolithic v1 package and the custom transport glue. |
| HTTP edge | Hono | It is already in the project and is directly supported by MCP v2. There is no architectural reason to introduce Express, Fastify, or another API framework. |
| AWS reliability | Lambda Powertools for TypeScript | Logger, Metrics, Idempotency, Batch Processing, Parameters, Parser, and Data Masking cover concrete Lambda/SQS production concerns with modular packages. |
| Durable workflow | Lambda + SQS + DynamoDB + DynamoDB Streams/EventBridge | This already matches the bounded asynchronous investigation resource. Queue retry plus idempotent writes is enough until observed execution or branching requirements prove otherwise. |
| AWS access | AWS SDK for JavaScript v3 | Use it for DynamoDB, SQS, EventBridge, SSM/Secrets, and Bedrock-only capabilities not exposed by AI SDK. Do not maintain two equivalent primary model clients. |
| Tracing standard | OpenTelemetry with AWS-supported Lambda instrumentation | AI SDK emits OpenTelemetry telemetry, and ADOT can export correlated traces to AWS observability services. Use one trace/correlation vocabulary across API, worker, capability, model, and event boundaries. |
| Tests and evals | Vitest plus the existing golden-ticket/sabotage harness | Deterministic Finding Policy tests and bounded behavioral evals are more valuable than adding a framework-owned evaluation runtime. |

### AI SDK usage rule

Prefer explicit calls:

```ts
generateText({
  model,
  prompt,
  output: Output.object({ schema }),
});
```

Do not put `ToolLoopAgent` or another autonomous loop on the critical investigation path. The playbook decides which mandatory capabilities execute; the model never decides whether an Evidence Contract may be skipped and never assigns the final Finding Code or Investigation Decision.

### Powertools usage rule

Adopt it incrementally:

1. `Logger` and `Metrics` on every Lambda.
2. `Idempotency` on investigation creation and worker processing.
3. `Batch Processing` for SQS partial batch responses.
4. `Parameters` for cached SSM/Secrets access.
5. `Parser`/Zod at AWS event boundaries and `Data Masking` before telemetry.

Use OpenTelemetry/ADOT as the tracing backbone rather than installing both an OTel pipeline and a second independent tracing model. Powertools remains the structured logs, metrics, idempotency, batch, and parameter toolkit.

## Keep behind an interface

### Knowledge retrieval

Keep a `KnowledgeRetriever` port. The first implementation may use the committed, versioned curated index because it is cheap, reproducible, and testable. A platform's public documentation MCP can feed or verify that curated knowledge, but a live public documentation call must not become runtime case evidence.

Move to Bedrock Knowledge Bases or another managed vector store only when measured corpus size, refresh frequency, retrieval quality, or access-control requirements exceed the committed index. A managed RAG product before those constraints are observed would add infrastructure without improving the first diagnosis.

### Direct Bedrock SDK

AI SDK should be the default text-generation interface. Retain direct `@aws-sdk/client-bedrock-runtime` calls only for a named capability that AI SDK does not support adequately, such as a provider-specific inference or embedding operation. Each direct use should be isolated behind a small port rather than leaking Bedrock response types into the domain.

## Defer deliberately

| Tool | Decision | Reconsider when |
| --- | --- | --- |
| LangGraph.js | Defer | A single investigation becomes a genuinely long-running, branching, checkpointed graph with human suspension that SQS plus DynamoDB cannot express cleanly. Its own docs position it as a low-level orchestration runtime; that responsibility is currently owned by the deterministic playbook and AWS workflow. |
| Mastra | Defer | The product needs a framework-owned agent/workflow/memory/studio runtime. Today that would overlap the domain, AWS durability, MCP, observability, and eval seams already chosen. |
| AI SDK Workflow | Defer | A bounded worker can no longer recover safely through idempotent queue retry and persisted state. AI SDK Core does not require adopting its workflow runtime. |
| Amazon Bedrock AgentCore Harness | Defer | A separate autonomous loop needs configuration-owned Strands orchestration, isolated stateful sessions, shell/filesystem, managed skills or per-session memory. The deterministic first-party playbook does not. |
| Amazon Bedrock AgentCore Runtime | Defer | A proven workload needs a custom ARM64 container/protocol, long-running isolated sessions or execution characteristics Lambda cannot satisfy safely or economically. |
| Amazon Bedrock AgentCore Gateway / Registry | Defer | Multiple teams need an organization-wide governed tool/MCP catalog, centralized identity/policy, discovery and approval beyond the bounded Support MCP deployment. |
| Amazon Bedrock AgentCore Evaluations | Defer | Production OpenTelemetry traces need online/on-demand LLM-as-judge evaluation beyond deterministic domain tests and the offline golden set. |
| Langfuse | Defer, keep compatible | The team needs a dedicated prompt/generation explorer and experiment UI beyond CloudWatch and the existing eval reports, and data residency, PII masking, retention, and cost are approved. Its OpenTelemetry foundation makes later adoption possible without redesigning the domain. |
| Bedrock Knowledge Bases | Defer | Retrieval benchmarks show the curated index is the bottleneck, or the internal corpus and authorization model require managed ingestion and retrieval. |
| Step Functions, Temporal, Inngest | Defer | Observed duration, branching, compensation, or operator recovery cannot be represented cleanly by the persisted investigation state and queue worker. |

## Remove from the focused slice

| Current element | Action | Reason |
| --- | --- | --- |
| `@strands-agents/sdk` on the investigation path | Remove after the AI SDK migration | Strands is a valid AWS-oriented agent framework, but its model-driven loop conflicts with the deterministic Fulfillment Playbook. Keeping both Strands and AI SDK would create two orchestration abstractions. |
| `@modelcontextprotocol/sdk` v1 | Replace with v2 packages | MCP v2 is the stable 2026-07-28 line and has first-party Hono integration. |
| First-party worker calling its own Support MCP endpoint | Remove | The worker should call the shared Operational Capability module directly. MCP is an external adapter, not an internal RPC tax. |
| Direct `openai` client | Remove if no explicit unsupported provider feature remains | Route optional OpenAI-compatible experiments through an AI SDK provider adapter. The production path remains Bedrock. |
| Hand-written MCP HTTP transport lifecycle | Remove during v2 migration | Use the SDK's official Hono/Web Standard integration and retain protocol-level contract tests. |

Do not remove `@aws-sdk/client-bedrock-runtime` blindly: the current knowledge embedding path may still need it until the retrieval adapter is migrated or retained intentionally.

## MCP boundaries

A public documentation MCP and the internal Support MCP have different jobs:

- **Documentation MCP (a platform's public one):** versioned product documentation and OpenAPI knowledge; useful for knowledge ingestion, grounding, and developer exploration — never runtime case evidence.
- **Support MCP:** governed, read-only operational capabilities backed by authorized platform APIs; useful to independent AI hosts and future internal consumers.
- **CX analytics MCP:** required second slice for aggregate conversations, transfers, CSAT, and operational impact. It should consume human-reviewed findings to create the Product/Engineering insight loop. Direct case correlation remains forbidden unless an authorized explicit reference exists.

The first-party Fulfillment Investigator does not need to route its own calls through MCP. It shares the same capability implementation that the MCP adapter exposes.

## Migration sequence

1. Extract the existing platform tools into framework-free Operational Capability modules with Zod input/output schemas.
2. Implement the deterministic Fulfillment Playbook and Finding Policy over those modules; keep the model fake in tests.
3. Replace Strands model orchestration with AI SDK Core over Bedrock for bounded extraction and explanation.
4. Upgrade the MCP edge to the v2 server and Hono packages, reusing the same capability schemas and handlers.
5. Add Powertools logs, metrics, idempotency, SQS batch handling, parameter caching, and masking.
6. Establish the OpenTelemetry trace vocabulary and privacy allowlist before exporting model inputs or outputs.
7. Remove superseded packages and the internal MCP hop only after contract, integration, and golden-ticket tests pass.

## Dependency adoption test

A proposed dependency must answer all four questions:

1. Which owned responsibility does it remove?
2. Which boundary contains it?
3. What evidence will trigger its adoption or removal?
4. Can the Evidence Ledger, Finding Policy, and human review model survive its replacement?

If it cannot answer those questions, it is framework accumulation rather than platform design.

## Primary sources

- [AI SDK introduction](https://ai-sdk.dev/docs/introduction)
- [AI SDK structured output](https://ai-sdk.dev/docs/ai-sdk-core/generating-structured-data)
- [AI SDK telemetry](https://ai-sdk.dev/docs/ai-sdk-core/telemetry)
- [AI SDK Amazon Bedrock provider](https://ai-sdk.dev/providers/ai-sdk-providers/amazon-bedrock)
- [MCP TypeScript SDK v2](https://ts.sdk.modelcontextprotocol.io/v2/)
- [MCP v2 upgrade guide](https://ts.sdk.modelcontextprotocol.io/v2/migration/upgrade-to-v2)
- [MCP v2 Hono integration](https://ts.sdk.modelcontextprotocol.io/v2/serving/hono.html)
- [Powertools for AWS Lambda (TypeScript)](https://docs.aws.amazon.com/powertools/typescript/latest/)
- [Powertools idempotency](https://docs.aws.amazon.com/powertools/typescript/latest/features/idempotency/)
- [Tracing TypeScript Lambda functions](https://docs.aws.amazon.com/lambda/latest/dg/typescript-tracing.html)
- [AWS Distro for OpenTelemetry JavaScript](https://docs.aws.amazon.com/xray/latest/devguide/xray-js-opentel-sdk.html)
- [Amazon Bedrock AgentCore overview](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/what-is-bedrock-agentcore.html)
- [LangGraph.js overview](https://docs.langchain.com/oss/javascript/langgraph/overview)
- [Mastra documentation](https://mastra.ai/docs)
- [Strands Agents model providers](https://strandsagents.com/docs/user-guide/concepts/model-providers/)
- [Langfuse SDK and OpenTelemetry overview](https://langfuse.com/docs/observability/sdk/overview)
