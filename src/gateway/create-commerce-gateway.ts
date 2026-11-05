import type { CommerceGateway } from './commerce-gateway.ts';
import { createFixtureCommerceGateway } from './fixture-commerce-gateway.ts';

/**
 * The single place every entrypoint (`cli.ts`, the Investigations API
 * Lambda, the Support MCP Lambda) obtains its `CommerceGateway` (ADR-0005).
 *
 * The project runs on fixtures only: this always returns the fixture
 * gateway, which needs no credentials and makes no network calls. Keeping
 * the factory (rather than having callers import the fixture directly) is
 * what lets a live adapter be added later — implement `CommerceGateway`,
 * prove it with the shared contract suite, and select it here — without a
 * code change anywhere else in the agent or Support MCP.
 *
 * Test suites that need a real Support MCP server (`mcp/server.test.ts`,
 * `mcp/lambda-handler.test.ts`) deliberately call
 * `createFixtureCommerceGateway()` directly instead of this factory — the
 * project's testing decisions pin them to the fixture regardless of how this
 * factory evolves, so `pnpm test` stays deterministic and credential-free.
 */
export function createCommerceGateway(): CommerceGateway {
  return createFixtureCommerceGateway();
}
