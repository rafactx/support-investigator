---
status: accepted, amended by ADR-0048
---

# DynamoDB is the operational store; Streams publish domain events when consumers exist

DynamoDB stores each Investigation Audit Trail and its Current Investigation projection, using transactional and conditional writes so appending history, advancing a revision and updating the projection remain consistent. The first deployed slice adopts this store while investigation execution remains synchronous; an in-memory adapter exists only for local tests.

The first table design is intentionally narrow: investigation items share `PK = INV#<investigationId>`; the materialized projection uses `SK = CURRENT`; immutable audit records use ordered `SK = EVT#<revision>#<eventId>`. A `TransactWriteItems` operation conditionally checks the current revision, inserts the event only if absent and advances the projection atomically. Creation idempotency uses a scoped key item that points repeated submissions to the original Investigation. The table uses on-demand billing and stores no raw operational payload or support-ticket text.

When the first asynchronous consumer is implemented, domain events leave the store through DynamoDB Streams and an EventBridge Pipe to a dedicated Support Investigator event bus instead of a synchronous database-plus-bus dual-write. The first CX consumer receives `FindingReviewed` through its own SQS queue, gaining buffering, retries and failure isolation.

## Consequences

The first slice does not add Streams consumers, EventBridge, SQS, RDS, Kinesis, Kafka, Step Functions or a listing/search index merely to demonstrate future topology. Investigations are recovered through their stable identity in the resource URL. Stream and queue consumers are added only with a real consumer and are idempotent because AWS event delivery can repeat; every asynchronous target has failure handling and a dead-letter queue. Historical analytical storage such as S3 and Athena is introduced only when the CX Intelligence Loop needs queries DynamoDB should not serve.
