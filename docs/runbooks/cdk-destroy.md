# `cdk destroy` runbook

The reference AWS stack (`SupportInvestigatorStack`, region `us-east-2`, account per `CDK_ACCOUNT_ID` — see `.env.example`) exists only for a demo window (ADR-0002) — it is not meant to stay up indefinitely. This is the documented teardown step; running it is a deliberate, separate action.

## Prerequisites (only relevant if redeploying after a destroy)

The stack references, but never creates, the `x-demo-key` SSM SecureString parameter. If it was deleted (see step 3 below) and you need to deploy again:

```bash
aws ssm put-parameter \
  --name "/support-investigator/demo-key" \
  --type SecureString \
  --value "<a fresh random value>" \
  --region us-east-2
```

Then `pnpm cdk deploy`.

## Retrieving the live demo key

The `x-demo-key` value itself is never in this repo (SSM SecureString) — retrieve it from SSM directly:

```bash
aws ssm get-parameter \
  --name "/support-investigator/demo-key" \
  --with-decryption \
  --region us-east-2 \
  --query Parameter.Value \
  --output text
```

## Tear down

1. **Destroy the CloudFormation stack.** This removes the two application Lambdas, the demo-key authorizer, the HTTP API, the CloudFront distribution, the DynamoDB Investigation table and their IAM roles:

   ```bash
   pnpm cdk destroy
   ```

   Confirm when prompted (`y`). The account-wide `CDKToolkit` bootstrap stack is not touched.

2. **Verify nothing is left reachable**:

   ```bash
   aws cloudformation describe-stacks --stack-name SupportInvestigatorStack --region us-east-2
   ```

   Expect this to fail with `Stack with id SupportInvestigatorStack does not exist` — that's the success case.

3. **Delete the demo-key SSM parameter** (optional, but the clean-slate option — CDK never created it, so `cdk destroy` never removes it either):

   ```bash
   aws ssm delete-parameter --name "/support-investigator/demo-key" --region us-east-2
   ```

   Skip this step if you intend to redeploy soon and want to keep the same demo key.

## What this does *not* remove

- The SPA S3 bucket, which CDK retains by default. Empty and delete it with `aws s3 rb s3://<bucket-name> --force` if you want it gone.
- The CDK bootstrap stack (`CDKToolkit`) and its S3/ECR bootstrap resources — shared, account-wide, out of this project's scope to manage.
- The IAM user `support-investigator-deploy` and the `deploy-admins` group — created outside CDK, not part of this stack.
- Bedrock model access / inference profile grants for the account — these are account-level Bedrock console settings, not stack resources.

## Cost note

While the stack is up, cost is effectively zero outside active demo usage: both application Lambdas and the authorizer are pay-per-invocation, the HTTP API has no fixed monthly charge, and no NAT gateway, RDS instance, or other always-on billed resource exists anywhere in `support-investigator-stack.ts`. The reason to run this runbook is security (ADR-0002: the public endpoint does not stay up outside the demo window), not cost.
