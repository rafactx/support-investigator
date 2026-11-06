import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';

// Independent source of truth for every assertion below: the CI gate's
// written requirements, never re-derived from the workflow YAML this test
// exercises or from `package.json`'s current script list. The `pnpm evals`
// golden-ticket harness was removed along with the old `/investigate` route
// it exercised; `pnpm evals:intake` (the Language Assistance evaluation) is
// now the gate's only `evals*` step.
//
//   "A GitHub Actions workflow gating PRs on typecheck, lint, unit tests,
//   `pnpm evals` ..., and `cdk synth`"
//   "`pnpm evals:live` is not part of the required gate (informational only)"
//   "Deploy remains manual (`workflow_dispatch`); CI never auto-deploys"
//   "A status badge is added to the README reflecting the workflow"

const REPO_ROOT = fileURLToPath(new URL('../..', import.meta.url));
const WORKFLOWS_DIR = fileURLToPath(new URL('.', import.meta.url));

interface WorkflowStep {
  name?: string;
  run?: string;
  uses?: string;
}

interface WorkflowJob {
  name?: string;
  steps: WorkflowStep[];
}

interface Workflow {
  on: Record<string, unknown> | string | string[];
  jobs: Record<string, WorkflowJob>;
}

function loadWorkflow(fileName: string): Workflow {
  const raw = readFileSync(`${WORKFLOWS_DIR}${fileName}`, 'utf-8');
  return parse(raw) as Workflow;
}

function onKeys(workflow: Workflow): string[] {
  const on = workflow.on;
  if (typeof on === 'string') return [on];
  if (Array.isArray(on)) return on;
  return Object.keys(on);
}

function allSteps(workflow: Workflow): WorkflowStep[] {
  return Object.values(workflow.jobs).flatMap((job) => job.steps);
}

// pnpm's own built-in subcommands — invoking these isn't "running a
// package.json script", so they're not checked against package.json.
const PNPM_BUILTINS = new Set(['install', 'add', 'remove', 'i']);

// Every `pnpm <script>` a step invokes, e.g. "pnpm cdk synth" -> "cdk".
function pnpmScriptsInvoked(steps: WorkflowStep[]): string[] {
  const scripts: string[] = [];
  for (const step of steps) {
    const match = step.run?.match(/(?:^|\n)\s*pnpm (?:run )?([a-z:-]+)/);
    if (match?.[1] && !PNPM_BUILTINS.has(match[1])) scripts.push(match[1]);
  }
  return scripts;
}

describe('CI workflow', () => {
  const ci = loadWorkflow('ci.yml');

  it('runs on pull_request, and the gate job runs typecheck, lint, unit tests, pnpm evals:intake, cdk synth and the Worker bundle check', () => {
    expect(onKeys(ci)).toContain('pull_request');

    const runCommands = allSteps(ci)
      .map((step) => step.run)
      .filter((run): run is string => Boolean(run))
      .join('\n');

    expect(runCommands).toMatch(/pnpm (run )?typecheck/);
    expect(runCommands).toMatch(/pnpm (run )?lint/);
    expect(runCommands).toMatch(/pnpm (run )?test/);
    expect(runCommands).toMatch(/pnpm evals:intake(?!:live)/); // "pnpm evals:intake", not "pnpm evals:intake:live"
    expect(runCommands).toMatch(/pnpm cdk synth/);
    expect(runCommands).toMatch(/pnpm cf:check/);
    // The old `/investigate`-route golden-ticket harness is gone
    // entirely — "pnpm evals" (without a `:intake` suffix) must not appear.
    expect(runCommands).not.toMatch(/pnpm evals(?!:)/);
  });

  it('pnpm evals:live and pnpm evals:intake:live never appear in the gate workflow', () => {
    const runCommands = allSteps(ci)
      .map((step) => step.run)
      .filter((run): run is string => Boolean(run))
      .join('\n');

    expect(runCommands).not.toMatch(/evals:live/);
    expect(runCommands).not.toMatch(/evals:intake:live/);
  });

  it('has a single job with a stable id and name, so it can be a required check', () => {
    expect(Object.keys(ci.jobs)).toEqual(['ci']);
    expect(ci.jobs.ci?.name).toBe('ci');
  });

  it('the gate workflow never deploys and triggers on nothing but push/pull_request', () => {
    // No step anywhere in this workflow runs `cdk deploy` — deploy stays the
    // CLI path ADR-0002 already decided (dedicated IAM user, not this
    // workflow) and already exercised by a real deploy.
    const ciRunCommands = allSteps(ci)
      .map((step) => step.run)
      .filter((run): run is string => Boolean(run))
      .join('\n');
    expect(ciRunCommands).not.toMatch(/cdk deploy/);
    expect(ciRunCommands).not.toMatch(/pnpm cf:deploy|wrangler deploy(?! --dry-run)/);

    // The stronger half: `on` is a subset of {push, pull_request} — no
    // `workflow_dispatch`, `schedule`, or `workflow_run` trigger could ever
    // fire a deploy path from inside this workflow.
    for (const key of onKeys(ci)) {
      expect(['push', 'pull_request']).toContain(key);
    }
  });

  it('the README status badge points at a workflow file that exists', () => {
    const readme = readFileSync(`${REPO_ROOT}README.md`, 'utf-8');
    const badgeMatch = readme.match(/workflows\/([\w.-]+\.yml)\/badge\.svg/);

    expect(badgeMatch).not.toBeNull();
    const badgeWorkflowFile = badgeMatch?.[1] ?? '';
    // Independent check: the referenced file is actually present in
    // .github/workflows — a typo'd filename would still "look like" a badge.
    expect(() => loadWorkflow(badgeWorkflowFile)).not.toThrow();
  });

  it('every pnpm <script> the gate workflow invokes is a real package.json script', () => {
    const packageJson = JSON.parse(readFileSync(`${REPO_ROOT}package.json`, 'utf-8')) as {
      scripts: Record<string, string>;
    };
    const invoked = pnpmScriptsInvoked(allSteps(ci));

    expect(invoked.length).toBeGreaterThan(0);
    for (const script of invoked) {
      expect(packageJson.scripts).toHaveProperty(script);
    }
  });
});
