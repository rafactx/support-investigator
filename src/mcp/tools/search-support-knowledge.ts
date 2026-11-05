import type { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';
import type { EmbedProvider } from '../../kb/embeddings/embed-provider.ts';
import { searchSupportKnowledge } from '../../kb/search.ts';
import type { KnowledgeIndex } from '../../kb/types.ts';

/**
 * Registers `search_support_knowledge` on the given MCP server. Returns
 * scored, cited `results[]` (title/url/excerpt/score) from the frozen
 * `KnowledgeIndex` via in-memory cosine similarity.
 *
 * `queryProvider` must be the embedder that built `index` (ADR-0009);
 * `searchSupportKnowledge` refuses a mismatch. The caller builds it, so this
 * module imports no concrete provider: Node entrypoints use
 * `createQueryEmbedProvider`, the Cloudflare Worker uses its own factory,
 * and neither drags the other's dependencies into its bundle.
 */
export function registerSearchSupportKnowledgeTool(
  server: McpServer,
  index: KnowledgeIndex,
  queryProvider: EmbedProvider,
): void {
  server.registerTool(
    'search_support_knowledge',
    {
      title: 'Search support knowledge',
      description:
        'Searches the frozen support-runbook knowledge index and returns scored, cited results[] ' +
        '(title/url/excerpt/score) via in-memory cosine similarity.',
      inputSchema: z.object({
        query: z.string().describe('The support-knowledge search query'),
        limit: z
          .number()
          .int()
          .positive()
          .default(5)
          .describe('Maximum number of results'),
      }),
    },
    async ({ query, limit }) => {
      const results = await searchSupportKnowledge(
        index,
        query,
        limit,
        queryProvider,
      );
      return { content: [{ type: 'text', text: JSON.stringify({ results }) }] };
    },
  );
}
