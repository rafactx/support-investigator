---
status: accepted
---

# CI is one required `ci` job that also checks the Worker bundle

Amends ADR-0017. Its decisions stand (Biome linter-only, no deploy workflow, one sequential job), but three facts it records have changed.

**Job name and required check.** The job id and display name are both `ci`, so the status check on a pull request is named `ci` and can be required by a branch ruleset on `main`. `.github/workflows/ci-workflow.test.ts` asserts the workflow has exactly this one job.

**Steps.** After `pnpm install --frozen-lockfile`, the job runs seven commands in this order: `pnpm typecheck`, `pnpm lint`, `pnpm build:web`, `pnpm test`, `pnpm evals:intake`, `pnpm cdk synth` and `pnpm cf:check`. `pnpm evals` no longer exists (ADR-0046); `pnpm evals:intake` is the deterministic replacement, and the live variant `pnpm evals:intake:live` never runs in CI. `pnpm build:web` runs before the three steps that read `web/dist`: the CDK stack tests and `cdk synth` stage it as an asset, and `pnpm cf:check` (`wrangler deploy --dry-run`, ADR-0048) bundles it as Worker static assets. The workflow test checks that order. `cf:check` does not rebuild the SPA itself, so CI builds it once.

**Account handling.** `infra/main.ts` no longer hardcodes the AWS account. It reads `CDK_ACCOUNT_ID` (and `CDK_REGION`, default `us-east-2`); when the variable is unset the stack is environment-agnostic, which is how CI runs `cdk synth` with no credentials.

Runs on pull requests cancel when a newer commit arrives on the same branch. Runs on `main` always finish, so the status badge never shows a cancelled run. The job has a 20-minute timeout, and third-party actions are pinned to commit SHAs that Dependabot updates.
