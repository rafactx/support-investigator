# Deploy the live demo to Cloudflare

One Worker serves the Investigations API, the Support MCP and the SPA on one origin ([ADR-0048](./adr/0048-cloudflare-workers-is-the-live-demo-target-with-workers-ai.md)). Everything in this runbook runs from the repository root. Nothing here is needed for local development or CI.

You need a Cloudflare account (the Workers Free plan is enough), Node.js 22+ and pnpm.

## 1. Check the bundle locally

```bash
pnpm install
pnpm build:web       # the Worker serves web/dist as static assets
pnpm cf:check        # wrangler deploy --dry-run --outdir dist/worker
```

This needs no login. It prints the bindings and the upload size; the Worker is about 2 MiB raw, 350 KiB gzipped, well under the 3 MiB Free-plan limit.

## 2. Log in and create the database

```bash
pnpm exec wrangler login
pnpm exec wrangler d1 create support-investigator
```

Copy the `database_id` it prints into `wrangler.jsonc`, replacing the live demo's id. Then apply the migrations to the remote database:

```bash
pnpm cf:migrate      # wrangler d1 migrations apply support-investigator --remote
```

The four rate limiters use `namespace_id` values `4801`–`4804`. They must be unique within your account; change them in `wrangler.jsonc` if another Worker already uses those numbers.

## 3. Set the secrets

```bash
openssl rand -hex 32 | pnpm exec wrangler secret put RATE_LIMIT_SALT
pnpm exec wrangler secret put DEMO_KEY      # optional: your own key that bypasses the limits
```

`RATE_LIMIT_SALT` salts the digest of each client address, so rate-limit keys cannot be reversed to IP addresses. Keep `DEMO_KEY` private; anyone with it skips every limit, including the model budget. An invalid key gets a `401`.

## 4. Deploy

```bash
pnpm cf:deploy       # builds web/dist, then `wrangler deploy`
```

Wrangler prints the URL, for example `https://support-investigator.<your-subdomain>.workers.dev`. The first Workers AI call creates the account's `default` AI Gateway. Request logging and caching are switched off per request, so ticket text is not stored there.

## 5. Smoke the deployment

```bash
SUPPORT_INVESTIGATOR_API_URL=https://support-investigator.<your-subdomain>.workers.dev \
SUPPORT_INVESTIGATOR_DEMO_KEY=<your DEMO_KEY> \
pnpm smoke:deployed
```

It runs the Public Reference Scenarios, a review, an explanation improvement and the MCP tools against the live URL, with the demo key so the limits do not interfere. Explanation improvement is reported as `exercised` when Workers AI answered and `skipped` otherwise. Then open the URL in a browser and run one investigation without the key.

Logs and traces are in the dashboard under **Workers & Pages → support-investigator → Observability**, or live with `pnpm exec wrangler tail`. Denied requests log `{"event":"rate_limited","rule":…}` with a truncated client digest, never an address.

## 6. Optional: semantic search with Workers AI embeddings

The committed knowledge index is `lexical` and needs no model. To rebuild it with Workers AI embeddings (`@cf/baai/bge-m3`), create an API token with **Workers AI: Read** permission, then:

```bash
CLOUDFLARE_ACCOUNT_ID=<account id> CLOUDFLARE_API_TOKEN=<token> \
EMBED_PROVIDER=workers-ai pnpm kb:refresh
pnpm test            # the committed-index tests must still pass
pnpm cf:deploy
```

The index records its provider and model, and the Worker embeds queries with the same model through its `AI` binding (ADR-0009). Rebuilding the index costs a few hundred Neurons at most. Each search then costs one small embedding call.

## How spend is bounded

- Deterministic investigations, reads and reviews use no model.
- Only two requests call Workers AI: an investigation created with non-empty `ticketText`, and `POST /investigations/:id/explanations`. Each call has an output-token ceiling (300 and 700) and a 4 s timeout.
- Each client gets 3 model-assisted requests per minute (Rate Limiting binding), and all clients together get `RATE_LIMIT_MODEL_PER_DAY_GLOBAL` per UTC day, 50 by default (D1 counter). At the default model's prices a call costs well under 200 Neurons, so 50 calls stay inside the 10,000 Neurons Workers AI gives every account per day.
- On the Workers Free plan, Workers AI fails instead of billing past the daily allocation. The API then reports Language Assistance as unavailable and the deterministic path keeps working. On Workers Paid, usage past the allocation is billed at $0.011 per 1,000 Neurons, so keep the global budget at or below the allocation.
- The Workers Free plan allows 10 ms of CPU per request. Waiting on D1 or Workers AI does not count. If observability shows CPU-limit errors (`1102`) under real traffic, the Workers Paid plan raises the limit.

## Tear down

```bash
pnpm exec wrangler delete support-investigator
pnpm exec wrangler d1 delete support-investigator
```

## Local development

```bash
cp .dev.vars.example .dev.vars
pnpm cf:dev          # builds web/dist, applies migrations to the local D1, runs `wrangler dev`
```

Workers AI has no local emulation: the `AI` binding always calls your account. `.dev.vars.example` therefore sets `LANGUAGE_MODEL_PROVIDER=fake`, so local runs make no model calls. D1 and the rate limiters run locally.
