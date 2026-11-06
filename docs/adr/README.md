# Architecture decision records

One file per decision, numbered in the order the decisions were made. Superseded and amended records stay in place as history; the `status` line at the top of each file says which later record replaced or changed it.

| ADR | Decision | Status |
| --- | --- | --- |
| [0001](./0001-full-vertical-slice-scope.md) | Full vertical slice, scope kept — simplicity enforced at the architecture level, not by cutting features | superseded by ADR-0026 |
| [0002](./0002-live-aws-deploy-for-demo.md) | Deploy live to a real AWS account for demos, not IaC-only | accepted, amended by ADR-0048 |
| [0003](./0003-bedrock-default-provider.md) | Bedrock as default model provider, GLM as a documented alternative for free iteration | accepted, amended by ADR-0046 and ADR-0048 |
| [0004](./0004-insights-promoted-to-core.md) | Recurring-pattern insights promoted from bonus to core scope | superseded by ADR-0046 |
| [0005](./0005-fixture-first-commerce-gateway.md) | Fixture-first CommerceGateway; a live adapter is a seam, not an assumption | accepted |
| [0006](./0006-policy-gate-resolves-only-at-high-confidence.md) | Policy gate resolves only at high confidence; everything else escalates | superseded by ADR-0037 |
| [0007](./0007-mcp-server-per-request-transport-lifecycle.md) | Support MCP's Streamable HTTP transport: fresh `McpServer` + `StreamableHTTPServerTransport` per HTTP request, not one long-lived pair | superseded by ADR-0039 |
| [0008](./0008-no-delivery-options-defined-as-stock-with-zero-delivery-options.md) | `NO_DELIVERY_OPTIONS` defined as stock present + zero delivery options, not out-of-stock | accepted |
| [0009](./0009-knowledge-index-pins-its-own-embed-provider.md) | `KnowledgeIndex` pins its own embed provider; `search_support_knowledge` always queries with it, never with the ambient `EMBED_PROVIDER` | accepted |
| [0010](./0010-policy-gate-derives-confidence-deterministically.md) | The policy gate derives `diagnosis.confidence` deterministically from observed evidence; the model's own confidence claim never reaches `final` | superseded by ADR-0031 |
| [0011](./0011-permission-denied-is-its-own-fixture-failure-mode.md) | Permission-denied gets its own `OrderAccessDeniedError`, not a reused `OrderNotFoundError`; the tool-activity observer doesn't discriminate the underlying cause | accepted, amended by ADR-0046 |
| [0012](./0012-gateway-contract-suite-is-parameterized-by-target.md) | The gateway contract suite is parameterized by target, not literal-shared | accepted |
| [0013](./0013-agent-api-shares-the-investigate-seam-and-observes-real-tool-activity.md) | `POST /investigate` shares one `investigateTicket` seam with `pnpm dev investigate`, which now also observes real tool activity instead of assuming none failed | superseded by ADR-0046 |
| [0014](./0014-spa-dev-proxy-not-backend-cors.md) | Local-dev SPA reaches the Agent API through Vite's dev proxy, not backend CORS headers | accepted |
| [0015](./0015-insights-reads-persisted-eval-reports-from-disk.md) | `pnpm insights` reads persisted `final`-only eval reports from disk, gitignored, no dedupe across sources | superseded by ADR-0046 |
| [0016](./0016-two-bedrock-grants-non-streaming-converse-esm-mcp-lambda.md) | Two separate `bedrock:InvokeModel` grants, `stream: false` on the Bedrock provider, ESM-only for the Support MCP Lambda, and a region-dropping env bug in `search_support_knowledge` — four deploy-time facts the first live `cdk deploy` surfaced that no prior ADR anticipated | accepted, amended by ADR-0046 |
| [0017](./0017-ci-gate-is-the-local-command-list-in-one-job-deploy-stays-cli-only.md) | CI gate is the same 5 local commands, in one job; introducing Biome for `lint`; no GitHub Actions deploy workflow added | accepted |
| [0018](./0018-model-provider-glm-wired-in-at-the-cli-seam-only.md) | `MODEL_PROVIDER=glm` wired into `createModel`, scoped to the CLI seam only — the deployed stack stays Bedrock-only | superseded by ADR-0046 |
| [0019](./0019-mcp-route-gated-behind-demo-key-too.md) | The deployed `/mcp` route is gated behind the demo key, not left open | accepted, amended by ADR-0046 |
| [0020](./0020-policy-gate-verifies-evidence-against-real-tool-activity.md) | The policy gate's evidence is verified against real tool activity, not taken on the model's word | superseded by ADR-0031 |
| [0021](./0021-spa-hosted-on-s3-cloudfront-cors-locked-to-that-domain.md) | The SPA deploys to S3 + CloudFront; the API's CORS is locked to that domain | accepted |
| [0022](./0022-spa-carries-the-demo-key-as-a-user-supplied-header.md) | The SPA sends the demo key as a user-supplied header, never bundled in | accepted |
| [0023](./0023-spa-composes-a-design-system-not-a-custom-shell.md) | The SPA composes a design system's real primitives, not a hand-rolled shell | superseded — the SPA was rebuilt on Tailwind CSS v4 and Radix primitives |
| [0024](./0024-spa-dark-mode-via-token-overrides.md) | The SPA's dark mode is a token-override layer, not per-component rules | accepted |
| [0025](./0025-onboarding-drawer-explains-the-project-in-app.md) | The SPA explains itself in an in-app onboarding drawer, not a route or a modal | accepted |
| [0026](./0026-focused-fulfillment-investigation-as-the-first-scalable-slice.md) | Fulfillment investigation is the first bounded slice; scale comes from additional investigation kinds | accepted |
| [0027](./0027-cx-intelligence-loop-is-the-required-second-slice.md) | The CX intelligence loop is the required second slice | accepted |
| [0028](./0028-cx-insights-start-aggregate-and-case-correlation-must-be-explicit.md) | CX insights start aggregate and case correlation must be explicit | accepted |
| [0029](./0029-official-product-insights-require-human-reviewed-findings.md) | Official product insights require human-reviewed findings | accepted |
| [0030](./0030-symptoms-and-findings-have-separate-canonical-identities.md) | Symptoms and findings have separate canonical identities | accepted |
| [0031](./0031-finding-policy-assigns-codes-from-call-bound-evidence.md) | Finding Policy assigns codes from call-bound evidence | accepted |
| [0032](./0032-normalized-evidence-is-durable-raw-payloads-are-temporary.md) | Normalized evidence is durable; raw payloads are temporary | accepted |
| [0033](./0033-evidence-ledger-uses-typed-versioned-facts.md) | The Evidence Ledger uses typed, versioned facts | accepted |
| [0034](./0034-audit-trail-is-append-only-with-a-current-investigation-projection.md) | The audit trail is append-only with a Current Investigation projection | accepted |
| [0035](./0035-dynamodb-is-the-operational-store-and-streams-publish-domain-events.md) | DynamoDB is the operational store; Streams publish domain events when consumers exist | accepted, amended by ADR-0048 |
| [0036](./0036-investigations-are-resource-oriented-before-durable-asynchronous-execution.md) | Investigations are resource-oriented before execution becomes durable and asynchronous | accepted |
| [0037](./0037-investigation-decisions-never-claim-ticket-resolution.md) | Investigation Decisions never claim ticket resolution | accepted |
| [0038](./0038-evidence-contract-results-replace-global-confidence.md) | Evidence Contract Results replace global confidence | accepted |
| [0039](./0039-fulfillment-playbook-is-deterministic-and-mcp-is-an-adapter.md) | The Fulfillment Playbook is deterministic and MCP is an adapter | accepted |
| [0040](./0040-tooling-adoption-is-trigger-driven.md) | Tooling adoption is trigger-driven | accepted |
| [0041](./0041-spa-uses-hash-routing-for-the-investigation-resource-url.md) | The SPA reaches a Current Investigation through a hash route, not a path route | accepted |
| [0042](./0042-ai-sdk-core-and-strands-coexist-during-the-language-assistance-migration.md) | AI SDK Core and Strands coexist during the Language Assistance migration | superseded by ADR-0046 |
| [0043](./0043-ticket-text-idempotency-uses-a-digest-never-the-raw-text.md) | The `POST /investigations` idempotency fingerprint hashes ticket text, never stores it raw | accepted |
| [0044](./0044-intake-readiness-is-recomputed-on-read-never-stored.md) | Intake readiness (and its gaps) is recomputed on every read, never persisted as its own field | accepted |
| [0045](./0045-explanation-improvement-grounding-is-structural-not-semantic.md) | Explanation improvement grounding is structural, not semantic — and a Bedrock failure is never committed to the Audit Trail | accepted |
| [0046](./0046-cut-over-to-resource-oriented-investigation-and-remove-strands.md) | Cut over to the resource-oriented Investigation, remove Strands and the golden-ticket harness | accepted |
| [0047](./0047-public-demo-abuse-controls-are-platform-neutral-middleware.md) | Public-demo abuse controls are platform-neutral middleware; deterministic investigation needs no key | accepted, amended by ADR-0048 |
| [0048](./0048-cloudflare-workers-is-the-live-demo-target-with-workers-ai.md) | The live demo runs on one Cloudflare Worker with Workers AI; AWS CDK stays the reference deployment | accepted |
