---
status: accepted, amended by ADR-0046 and ADR-0048
---

# Bedrock as default model provider, GLM as a documented alternative for free iteration

The original plan defaulted to GLM (`glm-4.7-flash` via z.ai) to keep development-time evals free, with Bedrock implemented but not default. That justification lost its force once the project decoupled from a time budget (implementation delegated to coding agents), and it was a weak point for a project whose reference deployment is AWS. Testing confirmed the account was never actually blocked from Bedrock — bare model IDs fail with `ValidationException: ... on-demand throughput isn't supported`, but region-prefixed inference profile IDs (`us.anthropic.claude-haiku-4-5-...`) work, verified with a live `aws bedrock-runtime converse` call. `MODEL_PROVIDER` now defaults to `bedrock`; GLM stays implemented and documented as the free-iteration / comparison path, but the deployed demo runs on Bedrock.

**Update:** Bedrock-as-default still stands, but `MODEL_PROVIDER=glm` and `createModel` no longer exist — the resource-oriented cutover removed `@strands-agents/sdk` and the CLI seam (`pnpm dev investigate`) that was GLM's only wiring point, with no replacement. Bedrock (via AI SDK Core) is now the only model provider anywhere in the codebase. See ADR-0018's own supersede note and ADR-0046.
