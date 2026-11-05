import { describe } from 'vitest';
import { createInMemoryInvestigationRepository } from './investigation-repository.ts';
import { describeInvestigationRepositoryContract } from './investigation-repository.contract.ts';

/**
 * Registers the shared `InvestigationRepository` contract
 * against the in-memory adapter — the local-test/demo implementation
 * ADR-0036 requires. The DynamoDB-backed adapter registers the same
 * contract in `src/persistence/dynamodb-investigation-repository.contract.test.ts`.
 */
describe('InMemoryInvestigationRepository', () => {
  describeInvestigationRepositoryContract(() => createInMemoryInvestigationRepository());
});
