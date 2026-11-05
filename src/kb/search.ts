import { cosineSimilarity } from './cosine-similarity.ts';
import type { EmbedProvider } from './embeddings/embed-provider.ts';
import type { KnowledgeIndex, KnowledgeSearchResult } from './types.ts';

/**
 * `search_support_knowledge(query, limit)`: embeds `query` with
 * `provider`, ranks every chunk in `index` by cosine similarity, and
 * returns the top `limit` as `{ title, url, excerpt, score }`.
 *
 * `provider` must be the same embedder that built `index` — mixing, say,
 * a `bedrock-titan`-built index with a `lexical` query embedding produces a
 * cosine score over vectors from two unrelated embedding spaces, which is
 * not a meaningful similarity (ADR-0009). Refuses up front rather than
 * silently returning a nonsense ranking.
 */
export async function searchSupportKnowledge(
  index: KnowledgeIndex,
  query: string,
  limit: number,
  provider: EmbedProvider
): Promise<KnowledgeSearchResult[]> {
  if (provider.id !== index.provider || provider.dimensions !== index.dimensions) {
    throw new Error(
      `searchSupportKnowledge: embed provider mismatch — index was built with ` +
        `"${index.provider}" (${index.dimensions} dims), but was queried with ` +
        `"${provider.id}" (${provider.dimensions} dims)`
    );
  }

  const [queryEmbedding] = await provider.embed([query]);

  return index.chunks
    .map((chunk) => ({
      title: chunk.title,
      url: chunk.url,
      excerpt: chunk.excerpt,
      score: cosineSimilarity(queryEmbedding as number[], chunk.embedding),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}
