# Support Investigator — agent instructions

Read `README.md` for what the project is, `CONTEXT.md` for the domain language, and `docs/adr/` for every decision already made. Use the domain terms exactly as `CONTEXT.md` defines them.

## Commands

Use `pnpm` (pinned in `package.json`). Before proposing a change as done, run the same gates CI runs:

```bash
pnpm install --frozen-lockfile
pnpm typecheck && pnpm lint && pnpm build:web && pnpm test && pnpm evals:intake && pnpm cdk synth
```

Tests are deterministic and make no network or model calls. Keep it that way: inject fakes at the existing seams (`CommerceGateway`, `InvestigationRepository`, `LanguageAssistance`, `EmbedProvider`, `RateLimiter`).

## Non-negotiables

- The Fulfillment Playbook and Finding Policy decide; a model never chooses a capability, creates a Ledger Fact or assigns a Finding Code.
- Every Operational Capability and Support MCP tool is read-only.
- Raw ticket text and raw provider payloads are never persisted or logged.
- Log detailed errors server-side; return generic messages to clients.

## Agent skills

### Issue tracker

Issues live as GitHub issues in `rafactx/support-investigator`, managed via the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

The five canonical roles, each label string equal to its name. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context — `CONTEXT.md` + `docs/adr/` at the repo root. See `docs/agents/domain.md`.

### /implement workflow

After running `/implement`, open a PR for the work. The PR body must include `Closes #<issue-number>` (or `Closes #<n1>, #<n2>` for multiple issues) so merging closes the issue automatically. When the user says the merge is done, switch back to `main`.
