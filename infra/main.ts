import * as cdk from 'aws-cdk-lib';
import { SupportInvestigatorStack } from './support-investigator-stack.ts';

/**
 * CDK app entrypoint (`pnpm cdk <command>`). Deploys to the one
 * target account/region this project's demo runs in — the same account
 * `cdk bootstrap` was already run against, and the account
 * `create-model.ts`'s inference-profile ARNs and
 * `support-investigator-stack.test.ts`'s `EXPECTED_BEDROCK_MODEL_ARNS`
 * were independently verified against. Read from `CDK_ACCOUNT_ID` /
 * `CDK_REGION` (`.env`, `.env.example`) rather than a `CDK_DEFAULT_*`
 * multi-account convention: this is still a single-account demo project
 * (ADR-0002), the account id just doesn't belong hardcoded in a public
 * repo — the value itself isn't a secret, but there's no reason to name
 * it in source when an env var does the same job for free. Unset falls
 * back to an environment-agnostic stack (CDK's own standard behavior when
 * `env` is omitted): `pnpm cdk synth` in CI has neither this var nor real
 * credentials, and still needs to synth cleanly (README's own claim).
 * `pnpm cdk deploy` outside CI still needs it set for real.
 */
const app = new cdk.App();

const accountId = process.env.CDK_ACCOUNT_ID;

new SupportInvestigatorStack(app, 'SupportInvestigatorStack', {
  env: accountId ? { account: accountId, region: process.env.CDK_REGION ?? 'us-east-2' } : undefined,
  description: 'Support Investigator — durable Investigations API + Support MCP behind API Gateway',
});
