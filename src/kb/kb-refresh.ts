import { writeFileSync } from 'node:fs';
import { buildKnowledgeIndex } from './build-index.ts';
import { createEmbedProvider } from './embeddings/create-embed-provider.ts';
import { DEFAULT_INDEX_PATH } from './load-index.ts';
import { loadSupportArticles, SUPPORT_ARTICLES_DIR } from './support-articles.ts';

/**
 * `pnpm kb:refresh`: chunks and embeds `src/kb/articles/` with the
 * `EMBED_PROVIDER`-selected provider and writes `data/index.json`, which is
 * committed so content changes show up in review.
 *
 * The committed index uses `lexical` (no network), so it is reproducible apart
 * from `builtAt`. Queries use the provider recorded in the index (ADR-0009),
 * so switching to `workers-ai` or `bedrock-titan` is a rebuild, not a code
 * change.
 */
async function main(): Promise<void> {
  const docs = loadSupportArticles();
  // Built before logging so the log reads `provider.id` — the actually
  // resolved provider — rather than re-deriving `EMBED_PROVIDER`'s
  // default independently of `createEmbedProvider`'s own (single source
  // of truth, `create-embed-provider.ts`).
  const provider = createEmbedProvider();
  console.error(
    `Loaded ${docs.length} runbooks from ${SUPPORT_ARTICLES_DIR}. Embedding with EMBED_PROVIDER=${provider.id}...`,
  );

  const index = await buildKnowledgeIndex(docs, provider);

  writeFileSync(DEFAULT_INDEX_PATH, `${JSON.stringify(index, null, 2)}\n`);
  console.error(
    `Wrote ${index.chunks.length} chunks from ${docs.length} runbooks to ${DEFAULT_INDEX_PATH} ` +
      `(provider=${index.provider}, model=${index.model}, dimensions=${index.dimensions}).`,
  );
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
