---
status: accepted, amended by ADR-0048
---

# Public-demo abuse controls are platform-neutral middleware; deterministic investigation needs no key

A public demo has to let a reviewer try the full flow in one click, and it has to stop strangers from spending the model budget. The reference AWS deployment solves only the second problem: every route sits behind a shared `x-demo-key` (ADR-0019, ADR-0022). That also blocks the deterministic path, even though it costs nothing to run.

We decided on four things:

- **Deterministic investigation is open.** Creating, reading, correcting and reviewing an Investigation needs no key. These requests run fixture capabilities and a pure policy, so they cost no model spend.
- **Model-assisted requests are rate-limited, not key-gated.** This covers intake proposal (a create request with non-empty `ticketText`) and explanation improvement. They count against a per-client hourly limit and against a **global** daily budget. The global budget is the hard bound on spend, however many addresses a caller rotates through. When it is used up, the message says that investigations without ticket text still work.
- **Creation, writes and MCP calls have their own per-client limits**, so the audit trail and the MCP adapter cannot be flooded either.
- **A valid demo key bypasses the limits.** This is the owner's key. An invalid key gets a `401` rather than a silent downgrade, so a misconfigured key is visible.

All of this is one Hono middleware (`src/api/public-demo-guard.ts`) over a `RateLimiter` seam (`src/security/rate-limiter.ts`). It is not tied to a hosting platform. The repository ships an in-memory fixed-window limiter, which is correct for local development and tests and is per-instance on serverless. A public deployment must supply a `RateLimiter` backed by storage that every instance shares, such as a database table or a platform rate-limit binding. The middleware also caps the request body at 32 KiB before parsing. The API itself caps ticket text at 4,000 characters, identifiers at 128, and review notes at 2,000.

Rate-limit buckets use a salted SHA-256 digest of the client address (`cf-connecting-ip`, then `x-real-ip`, then the first `x-forwarded-for` hop). The raw address is never stored or logged. Denials return a generic `429` with `Retry-After`; the rule name and a truncated digest are logged server-side. Each model call also has an output-token ceiling (`model-language-assistance.ts`), which bounds the cost of each allowed call.

This design rests on one assumption: the hosting edge must overwrite the client-address headers. If a caller can forge them, it can mint fresh buckets, although the global model budget still holds. The Cloudflare Worker wires the middleware in front of the API and the Support MCP, with a binding-backed per-client limiter and a D1 global budget (ADR-0048). The reference AWS stack keeps its authorizer.
