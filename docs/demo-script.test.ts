import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// Keeps the README quickstart and docs/demo-script.md in step with the API
// field names and commands they document.

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));
const DOCS_DIR = fileURLToPath(new URL('.', import.meta.url));

function readRepoFile(relativePath: string): string {
  return readFileSync(`${REPO_ROOT}${relativePath}`, 'utf-8');
}

describe('README', () => {
  const readme = readRepoFile('README.md');

  it('documents the zero-credential quickstart path', () => {
    expect(readme).toContain('pnpm install && pnpm dev');
  });

  it('documents LANGUAGE_MODEL_PROVIDER as an opt-in alternative to the zero-credential default', () => {
    expect(readme).toContain('LANGUAGE_MODEL_PROVIDER=bedrock');
  });

  it('links to the demo script and the cdk destroy runbook', () => {
    expect(readme).toMatch(/docs\/demo-script\.md/);
    expect(readme).toMatch(/docs\/runbooks\/cdk-destroy\.md/);
  });
});

describe('docs/demo-script.md', () => {
  const script = readFileSync(`${DOCS_DIR}demo-script.md`, 'utf-8');

  it('documents the satisfied-contract case against the real Investigations API request/response shape', () => {
    expect(script).toContain('STOCK_WITHOUT_DELIVERY_OPTIONS');
    expect(script).toContain('SKU-2002');
    expect(script).toContain('destinationPostalCode');
    expect(script).toMatch(/ready_for_human_resolution/);
    expect(script).toMatch(/DESTINATION_NOT_COVERED/);
  });

  it('documents the Language Assistance case, showing an unconfirmed model proposal never resumes the Playbook', () => {
    expect(script).toMatch(/ticketText/);
    expect(script).toMatch(/awaiting_input/);
    expect(script).toMatch(/confirmed.*false|unconfirmed/);
  });

  it('documents the CI-goes-red sabotage case against the real gating command', () => {
    expect(script).toMatch(/pnpm test/);
    expect(script).toMatch(/sabotage/i);
    expect(script).toContain('finding-policy.ts');
  });

  it('documents the cdk destroy runbook as a required post-demo step', () => {
    expect(script).toMatch(/docs\/runbooks\/cdk-destroy\.md/);
    expect(script).toMatch(/required/i);
  });

  it('documents the deployed durable Investigation URL and its demo-key requirement', () => {
    expect(script).toMatch(/GET \/investigations\/:id/);
    expect(script).toMatch(/DynamoDB/);
    expect(script).toMatch(/x-demo-key/);
    expect(script).not.toMatch(/no first-party investigation route/i);
  });
});
