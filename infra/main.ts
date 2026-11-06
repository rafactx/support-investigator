import * as cdk from 'aws-cdk-lib';
import { SupportInvestigatorStack } from './support-investigator-stack.ts';

/**
 * `pnpm cdk <command>`. The account comes from `CDK_ACCOUNT_ID` so it is not
 * hardcoded in a public repo. Without it the stack is environment-agnostic,
 * which is how CI runs `cdk synth` with no credentials.
 */
const app = new cdk.App();

const accountId = process.env.CDK_ACCOUNT_ID;

new SupportInvestigatorStack(app, 'SupportInvestigatorStack', {
  env: accountId ? { account: accountId, region: process.env.CDK_REGION ?? 'us-east-2' } : undefined,
  description: 'Support Investigator — durable Investigations API + Support MCP behind API Gateway',
});
