# Demo script (3 minutes)

Three cases, run in order, each showing one claim: the Fulfillment Playbook and Finding Policy decide deterministically on satisfied evidence, Language Assistance proposes intake without deciding for N2 (ADR-0043/0044), and the test suite fails when a policy rule breaks. The request shapes match `src/api/investigations-app.test.ts`, and `docs/demo-script.test.ts` checks the field names used here.

Run everything from the repo root, after `pnpm install`. No platform or model credentials are required for any of the three cases — all three run against the fixture `CommerceGateway`. Case 2 calls a model only when you start the server with `LANGUAGE_MODEL_PROVIDER=workers-ai` or `LANGUAGE_MODEL_PROVIDER=bedrock` and matching credentials; with the default `fake` provider nothing is proposed, and the outcome is the same `awaiting_input`.

Start the local Investigations API first, in its own terminal:

```bash
pnpm dev serve   # POST /investigations, GET /investigations/:id on :8787
```

## Case 1 — Satisfied contract, ready for human resolution (~45s)

The reference scenario: stock exists, but there are zero delivery options for the destination, and the full route (inventory → simulation → warehouse-to-dock → dock-to-policy → destination coverage) confirms no shipping policy covers it.

```bash
curl -s -X POST http://localhost:8787/investigations \
  -H "Content-Type: application/json" -H "Idempotency-Key: demo-1" \
  -d '{
    "symptomCode": "STOCK_WITHOUT_DELIVERY_OPTIONS",
    "accountScope": { "accountId": "account-17" },
    "skuId": "SKU-2002",
    "seller": "1",
    "quantity": 1,
    "destinationPostalCode": "01310-100"
  }'
```

**Expected outcome:** `state: "completed"`, `evidence.contractResult: "satisfied"` (5 Ledger Facts, none contradicting), `finding.code: "DESTINATION_NOT_COVERED"`, `decision.outcome: "ready_for_human_resolution"`, `decision.reason: "contract_satisfied"`. No `mcpClient` in this app's own deps (asserted in `investigations-app.test.ts`) — the Fulfillment Playbook calls the 5 Operational Capabilities directly.

**Talking point:** `finding` and `decision` have no model-authored field. The Finding Policy is a pure function over the Evidence Ledger.

## Case 2 — Language Assistance proposes, N2 still has to confirm (~45s)

A model-extracted field is never pre-confirmed, so a ticket-text-only request cannot resume the Playbook, however complete the proposal is.

```bash
curl -s -X POST http://localhost:8787/investigations \
  -H "Content-Type: application/json" -H "Idempotency-Key: demo-2" \
  -d '{
    "symptomCode": "STOCK_WITHOUT_DELIVERY_OPTIONS",
    "accountScope": { "accountId": "account-17" },
    "ticketText": "SKU-2002, seller 1, qty 1, no delivery to 01310-100"
  }'
```

**Expected outcome:** `state: "awaiting_input"`, always — never `"completed"`. With a real provider, Language Assistance extracts `skuId`/`seller`/`quantity`/`destinationPostalCode` from the ticket text, but every one comes back `{ source: "model", confirmed: false }` and lands in `intakeGaps` with `reason: "unconfirmed"`. The Fulfillment Playbook's capabilities are never invoked (`capabilities.inventory.observe` — 0 calls, asserted in `investigations-app.test.ts`). With the `fake` provider the same fields land in `intakeGaps` as `missing` instead.

**Talking point:** Case 1's `skuId` was `{ source: "user", confirmed: true }`. Case 2's is `{ source: "model", confirmed: false }`, which N2 has to confirm through `PATCH /investigations/:id/intake` before the Playbook runs.

## Case 3 — CI goes red on purpose (~60s)

Offline, no credentials.

1. Break exactly one Finding Policy rule on purpose — a destination a coverage zone already covers stops contradicting the positive Finding (`src/domain/finding-policy.ts`, `evaluateFindingPolicy`'s contradiction switch):

   ```diff
        case 'destination-coverage':
   -      return fact.covered;
   +      return false;
   ```

2. Run the real CI gate command:

   ```bash
   pnpm test
   ```

   **Expected output** (captured from a real run against this exact edit):

   ```
    FAIL  src/domain/finding-policy.test.ts > Finding Policy for DESTINATION_NOT_COVERED > returns an undetermined finding for contradictory destination coverage evidence
   AssertionError: expected { …(5) } to match object { …(4) }

   - Expected
   + Received

     {
   -   "contractResult": "contradicted",
   -   "decision": "requires_specialist_review",
   -   "decisionReason": "evidence_contradictory",
   -   "findingCode": "ROOT_CAUSE_UNDETERMINED",
   +   "contractResult": "satisfied",
   +   "decision": "ready_for_human_resolution",
   +   "decisionReason": "contract_satisfied",
   +   "findingCode": "DESTINATION_NOT_COVERED",
     }

    Test Files  1 failed | ...
   ```

   `pnpm test` exits non-zero. The `ci` job in `.github/workflows/ci.yml` runs the same command, so a pull request with this change fails its required check.

3. Revert the sabotage before doing anything else:

   ```bash
   git checkout -- src/domain/finding-policy.ts
   pnpm test   # back to green
   ```

**Talking point:** a one-line change made a covered destination stop contradicting the Finding, which would show N2 a wrong Finding Code. `src/domain/finding-policy.test.ts` catches it as part of `pnpm test`.

## Required after an AWS demo: `cdk destroy`

The AWS stack exists only for the demo window (ADR-0002), and its routes are guarded by a shared-secret header. Run the teardown in `docs/runbooks/cdk-destroy.md` right after every AWS demo. The Cloudflare live demo is not torn down.

## Reference AWS deployment

The deployed API serves the same durable Investigation resource routes as local development: `POST /investigations`, `GET /investigations/:id`, `PATCH /investigations/:id/intake`, `POST /investigations/:id/explanations` and `POST /investigations/:id/reviews`. The Investigations Lambda persists the Audit Trail and Current Investigation projection in DynamoDB, so the SPA can reload `#/investigations/:id` after a new Lambda execution environment without losing it. Every route requires `x-demo-key`.

Retrieve the API and SPA URLs, then enter the demo key in the SPA's **Demo key** dialog before creating an Investigation:

```bash
aws cloudformation describe-stacks --stack-name SupportInvestigatorStack --region us-east-2 \
  --query "Stacks[0].Outputs[?OutputKey=='ApiUrl'].OutputValue" --output text

aws cloudformation describe-stacks --stack-name SupportInvestigatorStack --region us-east-2 \
  --query "Stacks[0].Outputs[?OutputKey=='SpaUrl'].OutputValue" --output text
```

The same key also protects the externally consumable `/mcp` adapter:

```bash
# The demo key (SSM SecureString, never committed — docs/runbooks/cdk-destroy.md):
aws ssm get-parameter --name "/support-investigator/demo-key" --with-decryption \
  --region us-east-2 --query Parameter.Value --output text

# The live /mcp URL, straight from the deployed stack's own output:
aws cloudformation describe-stacks --stack-name SupportInvestigatorStack --region us-east-2 \
  --query "Stacks[0].Outputs[?OutputKey=='SupportMcpUrl'].OutputValue" --output text
```

Any Streamable HTTP MCP client can connect to that URL with `x-demo-key: <value from above>`. The `pnpm dev inventory`, `simulate-fulfillment` and `search-knowledge` commands always use a local Support MCP server, not a deployed one.

For the complete repeatable deployed release run, export those two values as `SUPPORT_INVESTIGATOR_API_URL` / `SUPPORT_INVESTIGATOR_DEMO_KEY` and run `pnpm smoke:deployed`. It exercises the focused synthetic cases, durable review readback and authenticated MCP discovery; see [`docs/release-evidence.md`](./release-evidence.md) for the exact claims and skip semantics.
