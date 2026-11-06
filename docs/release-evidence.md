# Focused release evidence

Release evidence is intentionally split between a frozen, credential-free gate and an authenticated deployed smoke run. Neither component lets fixture behavior become a claim about live merchant diagnosis.

## Frozen gate

The CI workflow runs, in order, `pnpm install --frozen-lockfile`, typechecking, linting, SPA build, the full unit/integration suite, deterministic intake-extraction evaluation, CDK synthesis, and a dry-run build of the Cloudflare Worker bundle. The suite includes infrastructure assertions, the focused Public Reference Scenarios, the Finding Policy truth table, durability contracts, model-boundary sabotage regression, and MCP v2 adapter contracts.

`pnpm evals:intake` reports per-field precision/recall, false positives and invented-identifier rate against 30 labeled synthetic PT/EN tickets. Those are extraction-quality measurements only. It does not claim production diagnostic accuracy. `ROOT_CAUSE_UNDETERMINED` and `outside_supported_playbook` remain visible in the focused decision/review tests and smoke report as evidence of explicit uncertainty and taxonomy boundaries, not accuracy scores.

Live merchant contracts remain Vitest `skipped` without credentials and known-good merchant test IDs. `pnpm evals:intake:live` is informational and non-gating; unavailable provider access is reported as unavailable rather than as a passing result.

## Deployed fixture smoke (reference AWS deployment)

Deploy the current stack, retrieve the API URL and demo key, then run:

```bash
pnpm smoke:deployed
```

The command needs `SUPPORT_INVESTIGATOR_API_URL` and `SUPPORT_INVESTIGATOR_DEMO_KEY`. If either is absent it prints `SKIPPED` and exits successfully; it never substitutes a local result or calls that a pass.

Against the authenticated, deployed fixture adapter it proves:

- `DESTINATION_NOT_COVERED` with a satisfied Evidence Contract;
- missing intake, insufficient/contradictory evidence, and permission denial all fail closed to specialist review / `ROOT_CAUSE_UNDETERMINED`;
- a ticket-text attempt to inject facts or a decision cannot override capability-bound evidence;
- a declared Human Review with `outside_supported_playbook` persists and is readable again through `GET /investigations/:id`;
- the deterministic Source Pack explanation remains on the Current Investigation whether the optional Bedrock request succeeds, rejects, or is unavailable;
- MCP v2 discovers every focused read-only capability and invokes `observe_inventory` through the deployed authenticated adapter.

The command creates synthetic fixture investigations only. Its `mechanismEvidence` report explicitly prints the two Finding Codes, Evidence Contract results, `permission_denied`, and `outside_supported_playbook`; these are mechanism evidence, not accuracy scores. `liveMerchant: "skipped"` makes clear it does not use or validate a live merchant. Its `liveBedrock` result is `exercised` only when the optional deployed request completed, otherwise `skipped`; neither status is a model-quality score.

## Scope and attribution

The implemented release is a synchronous, durable Fulfillment Investigation with DynamoDB-backed Audit Trail / Current Investigation readback, resource routes, bounded Bedrock assistance, and an MCP v2 capability adapter. It does not introduce an SQS worker, DynamoDB Streams consumer, CX integration, extra Investigation Kind, or additional Finding Code. Public Reference Scenario identifiers, payload shapes and case composition are synthetic and self-designed; the project is independent and not affiliated with any commerce platform.
