import { chunkText } from './chunk.ts';
import type { EmbedProvider } from './embeddings/embed-provider.ts';
import type { KnowledgeIndex } from './types.ts';

const MAX_CHUNK_CHARS = 1000;
const EXCERPT_CHARS = 240;

/** One already-fetched curated document — the input to `buildKnowledgeIndex`. */
export interface FetchedDoc {
  title: string;
  url: string;
  content: string;
}

/**
 * Chunks and embeds `docs` into a `KnowledgeIndex` ("chunks
 * and embeds them into a frozen index.json"). Pure with respect to the
 * network — `docs` are already-fetched text, `provider` is an already-built
 * `EmbedProvider` — so this is testable without reading the runbook files
 * or making a live embedding call. `kb-refresh.ts` is the thin script
 * that supplies both by doing the actual I/O.
 */
export async function buildKnowledgeIndex(
  docs: FetchedDoc[],
  provider: EmbedProvider
): Promise<KnowledgeIndex> {
  const chunkedDocs = docs.flatMap((doc, docIndex) =>
    chunkText(doc.content, { maxChars: MAX_CHUNK_CHARS }).map((text, chunkIndex) => ({
      id: `doc-${docIndex}-chunk-${chunkIndex}`,
      title: doc.title,
      url: doc.url,
      text,
    }))
  );

  const embeddings =
    chunkedDocs.length > 0
      ? await provider.embed(chunkedDocs.map((chunk) => chunk.text))
      : [];

  return {
    builtAt: new Date().toISOString(),
    provider: provider.id,
    model: provider.model,
    dimensions: provider.dimensions,
    chunks: chunkedDocs.map((chunk, i) => ({
      id: chunk.id,
      title: chunk.title,
      url: chunk.url,
      text: chunk.text,
      excerpt:
        chunk.text.length > EXCERPT_CHARS
          ? `${chunk.text.slice(0, EXCERPT_CHARS)}…`
          : chunk.text,
      embedding: embeddings[i]!,
    })),
  };
}
