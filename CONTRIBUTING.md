# Contributing

## Setup

Requires Node.js 22+ and pnpm (the version is pinned in the `packageManager` field of `package.json`).

```bash
pnpm install
```

No credentials are needed. Tests use the fixture gateway and fake Language Assistance, and make no network or model calls.

## Checks

CI runs these on every pull request. Run them before you open one:

```bash
pnpm typecheck
pnpm lint
pnpm build:web
pnpm test
pnpm evals:intake
pnpm cdk synth
pnpm cf:check
```

`pnpm build:web` has to run before `pnpm test`, `pnpm cdk synth` and `pnpm cf:check`: the CDK stack stages `web/dist` as an asset, and the Worker serves it as static assets.

## Changes

- Branch from `main` and open a pull request into `main`. The `ci` check must pass before merge. Pull requests are squash-merged.
- Keep the domain terms from [`CONTEXT.md`](./CONTEXT.md). If a change reverses or alters a decision in [`docs/adr/`](./docs/adr/), add a new ADR and update the old one's status line instead of editing its history.
- Commit subjects are short, imperative and in plain English, e.g. "Add D1 contract test for stale revisions".

## Security

Do not open public issues for vulnerabilities. See [SECURITY.md](./SECURITY.md).
