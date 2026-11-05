import { createMcpHonoApp } from '@modelcontextprotocol/hono';
import { createMcpHandler, McpServer } from '@modelcontextprotocol/server';
import { createFulfillmentCapabilities } from '../capabilities/create-fulfillment-capabilities.ts';
import type { CommerceGateway } from '../gateway/commerce-gateway.ts';
import type { EmbedProvider } from '../kb/embeddings/embed-provider.ts';
import { createLexicalEmbedProvider } from '../kb/embeddings/lexical-embed-provider.ts';
import type { KnowledgeIndex } from '../kb/types.ts';
import { registerFulfillmentCapabilityTools } from './tools/fulfillment-capabilities.ts';
import { registerSearchSupportKnowledgeTool } from './tools/search-support-knowledge.ts';

export const MCP_PATH = '/mcp';

/**
 * The Support MCP server's dependencies. `gateway` backs the shared
 * Operational Capabilities; `knowledgeIndex` backs `search_support_knowledge`.
 * The knowledge index is its own dependency, never reached through
 * `CommerceGateway`: build-time knowledge (the runbooks indexed by
 * `pnpm kb:refresh`) and runtime operational access stay separate.
 *
 * `queryEmbedProvider` embeds search queries and must be the provider that
 * built the index (ADR-0009). It may be omitted only for a `lexical` index,
 * whose embedder has no dependencies; every other index needs the caller to
 * build it (`createQueryEmbedProvider` on Node, the Worker's own factory on
 * Cloudflare). This module stays Web Standard and imports no Node server or
 * hosted provider, so the Cloudflare Worker can bundle it.
 */
export interface SupportMcpDependencies {
  gateway: CommerceGateway;
  knowledgeIndex: KnowledgeIndex;
  queryEmbedProvider?: EmbedProvider;
}

export type SupportMcpServerFactory = (
  deps: SupportMcpDependencies,
) => McpServer;

function resolveQueryEmbedProvider({
  knowledgeIndex,
  queryEmbedProvider,
}: SupportMcpDependencies): EmbedProvider {
  if (queryEmbedProvider) return queryEmbedProvider;
  if (knowledgeIndex.provider === 'lexical') return createLexicalEmbedProvider();
  throw new Error(
    `Support MCP: the knowledge index was built with "${knowledgeIndex.provider}"; pass a matching queryEmbedProvider`,
  );
}

/**
 * Builds the Support MCP server and registers its tools. It is transport
 * agnostic: the Hono adapter below gives it the Web Standard HTTP surface.
 */
export function createSupportMcpServer(deps: SupportMcpDependencies): McpServer {
  const server = new McpServer({ name: 'support-mcp', version: '0.1.0' });
  registerFulfillmentCapabilityTools(
    server,
    createFulfillmentCapabilities(deps.gateway),
  );
  registerSearchSupportKnowledgeTool(
    server,
    deps.knowledgeIndex,
    resolveQueryEmbedProvider(deps),
  );
  return server;
}

/**
 * The v2 MCP/Hono adapter. `createMcpHandler` invokes the server factory for
 * every Web Standard request, so no server or transport lifecycle is shared
 * between requests, Lambda invocations or Worker isolates.
 */
export function createSupportMcpApp(
  deps: SupportMcpDependencies,
  serverFactory: SupportMcpServerFactory = createSupportMcpServer,
) {
  const app = createMcpHonoApp({ host: '0.0.0.0' });
  const handler = createMcpHandler(() => serverFactory(deps));
  app.all(MCP_PATH, (c) => handler.fetch(c.req.raw));
  return app;
}
