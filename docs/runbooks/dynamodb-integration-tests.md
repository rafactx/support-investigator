# Running the DynamoDB integration contract suite

`src/persistence/dynamodb-investigation-repository.contract.test.ts` runs the same `InvestigationRepository` behavioral contract (`src/domain/investigation-repository.contract.ts`) that `src/domain/investigation-repository.test.ts` runs against the in-memory adapter — this time against a real DynamoDB table. It is gated on `INVESTIGATION_TABLE_NAME` *and* a live `DescribeTableCommand` probe against it: unset (or unreachable, or credential-less) in CI and local runs by default, so `pnpm test` stays deterministic and credential-free — and a stale table name or expired credentials report `skipped`, never a hard failure.

This is a **scratch table you create and destroy yourself** — never the deployed stack's own table. It keeps contract checks isolated from a live demo's durable Investigation history.

## Provision a scratch table

The table needs only the ADR-0035 key schema (`PK`/`SK`, both strings) and on-demand billing:

```bash
aws dynamodb create-table \
  --table-name support-investigator-investigations-scratch \
  --attribute-definitions AttributeName=PK,AttributeType=S AttributeName=SK,AttributeType=S \
  --key-schema AttributeName=PK,KeyType=HASH AttributeName=SK,KeyType=RANGE \
  --billing-mode PAY_PER_REQUEST \
  --region us-east-2
```

Wait for it to become active:

```bash
aws dynamodb describe-table \
  --table-name support-investigator-investigations-scratch \
  --region us-east-2 \
  --query "Table.TableStatus" --output text
```

## Run the suite

```bash
AWS_REGION=us-east-2 \
INVESTIGATION_TABLE_NAME=support-investigator-investigations-scratch \
pnpm vitest run src/persistence/dynamodb-investigation-repository.contract.test.ts
```

Standard AWS credential resolution applies (env vars, shared credentials file, SSO profile — whatever `aws sts get-caller-identity` already resolves locally).

Confirm the skip behavior at least once by running the same command with `INVESTIGATION_TABLE_NAME` unset, and again pointed at a table name that doesn't exist — both must report `skipped`, not `passed` or a hard failure.

## Tear down

The suite creates and reuses many investigation ids per run (each test generates its own via `randomUUID()`, so runs never collide with each other) but never deletes anything — a scratch table can grow unbounded across repeated runs. Delete it when done:

```bash
aws dynamodb delete-table \
  --table-name support-investigator-investigations-scratch \
  --region us-east-2
```
