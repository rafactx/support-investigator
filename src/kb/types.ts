import { z } from 'zod';

/**
 * Identifies which `EmbedProvider` built (and must be used to query) a
 * `KnowledgeIndex`. Recorded on the index itself — see ADR-0009: mixing a
 * document vector built by one provider with a query vector built by
 * another produces a cosine score that is not meaningful.
 */
export const EmbedProviderIdSchema = z.enum(['bedrock-titan', 'local', 'lexical', 'workers-ai']);
export type EmbedProviderId = z.infer<typeof EmbedProviderIdSchema>;

/**
 * One embedded chunk of a support runbook. `text` is the chunk actually
 * embedded; `excerpt` is what `search_support_knowledge` shows the caller
 * (`results[]` with title/url/excerpt/score).
 */
const KnowledgeChunkSchema = z.object({
  id: z.string(),
  title: z.string(),
  url: z.string(),
  text: z.string(),
  excerpt: z.string(),
  embedding: z.array(z.number()),
});
export type KnowledgeChunk = z.infer<typeof KnowledgeChunkSchema>;

/**
 * The frozen, git-committed knowledge base `pnpm kb:refresh` produces
 * (committed to git so it is reproducible and reviewable). `provider`,
 * `model`, and `dimensions` pin down exactly what embedded every chunk so
 * `search_support_knowledge` can refuse to query it with a mismatched
 * embedder (ADR-0009) instead of silently returning meaningless scores.
 */
export const KnowledgeIndexSchema = z.object({
  builtAt: z.string(),
  provider: EmbedProviderIdSchema,
  model: z.string(),
  dimensions: z.number().int().positive(),
  chunks: z.array(KnowledgeChunkSchema),
});
export type KnowledgeIndex = z.infer<typeof KnowledgeIndexSchema>;

/** One `search_support_knowledge` result — the shape the knowledge-base requirement specifies. */
export interface KnowledgeSearchResult {
  title: string;
  url: string;
  excerpt: string;
  score: number;
}
