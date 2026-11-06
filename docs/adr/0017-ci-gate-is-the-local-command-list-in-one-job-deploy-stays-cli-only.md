---
status: accepted, amended by ADR-0049
---

# CI gate is the local command list in one job; Biome for `lint`; no GitHub Actions deploy workflow

The CI gate had to run `typecheck`, `lint`, unit tests, the evals and `cdk synth` on every pull request. Two things needed a decision that no prior ADR covers: what `lint` runs (no lint tool was installed before this change), and whether deploy should become a GitHub Actions workflow.

## `lint` is Biome, linter-only, not `biome check`

Biome was already the intended lint tool, but nothing installed it. Running `biome check .` (formatter and linter combined) against the existing code produced 8,067 errors and 17,070 warnings, almost all formatting differences across every file. Reformatting the whole repository in the same change would have buried the CI change itself. `biome lint .` (linter rules only) produced 1 error and 11 warnings, so `pnpm lint` runs `biome lint .`. The `formatter` block in `biome.json` matches the code's actual style (2 spaces, single quotes) for editor integration, but CI does not run it. A repository-wide reformat is a separate change.

The one lint error (`noUnsafeOptionalChaining` in `infra/support-investigator-stack.test.ts`) was fixed in the same change, so the gate was green on the commit that introduced it. `statements[0]` was already proven non-empty by the preceding `toHaveLength(1)`, so a non-null assertion is the correct fix. `src/kb/data/index.json` (the frozen Knowledge Index) is excluded from Biome's `files.includes`: it is generated data and exceeds Biome's default 1 MiB file-size limit. The 11 `noNonNullAssertion` warnings stay warnings, which is how Biome's recommended preset classifies them.

## No GitHub Actions deploy workflow

Deploy is manual. A first draft added `.github/workflows/deploy.yml` (`workflow_dispatch`, calling `cdk deploy` through `aws-actions/configure-aws-credentials` with an `AWS_DEPLOY_ROLE_ARN` secret). It was removed before merge. ADR-0002 defines deploy as a `cdk deploy` run from a developer's machine through a dedicated deploy IAM user, and that path had already been used against the target account (see `docs/runbooks/cdk-destroy.md`). No OIDC role or deploy secret exists for this repository, so the workflow could never run, while looking like working automation.

`.github/workflows/ci-workflow.test.ts` enforces that CI never deploys: no step runs `cdk deploy`, and the workflow triggers only on `push` and `pull_request`, so `workflow_dispatch`, `schedule` and `workflow_run` are absent. Deploying from GitHub Actions would need an OIDC trust policy, a new IAM role and a secret, and would be its own decision.

## One job, sequential steps, matching local development

`ci.yml` ran `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm evals` and `pnpm cdk synth` as sequential steps in one job, the same commands in the same order a developer runs locally. There is no matrix and no parallel jobs: the commands are fast, deterministic and need no credentials, and splitting them would add scheduling overhead without new signal. `pnpm evals` and `pnpm cdk synth` were both confirmed to run with every `AWS_*` variable removed and `AWS_CONFIG_FILE`/`AWS_SHARED_CREDENTIALS_FILE` pointed at `/dev/null`.

The workflow also runs on `push` to `main`, because a status badge shows the default branch's latest run and a `pull_request`-only trigger never produces one. A `concurrency` group keeps an older run from reporting after a newer one on the same ref.

ADR-0049 records the current job name, step list and account handling.
