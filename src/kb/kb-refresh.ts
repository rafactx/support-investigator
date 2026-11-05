import { writeFileSync } from 'node:fs';
import { buildKnowledgeIndex } from './build-index.ts';
import { createEmbedProvider } from './embeddings/create-embed-provider.ts';
import { DEFAULT_INDEX_PATH } from './load-index.ts';
import { loadSupportArticles, SUPPORT_ARTICLES_DIR } from './support-articles.ts';

/**
 * `pnpm kb:refresh`: loads every
 * committed support runbook under `src/kb/articles/`, chunks and embeds
 * them via the `EMBED_PROVIDER`-selected `EmbedProvider`, and writes the
 * frozen `KnowledgeIndex` to `data/index.json` — versioned in git so
 * content drift is reviewable in a diff, not silent.
 *
 * The committed index is built with the default `EMBED_PROVIDER=lexical`
 * (deterministic hashing bag-of-words, zero network), so anyone can
 * reproduce it byte-for-byte apart from `builtAt`.
 * `search_support_knowledge` always queries with the provider recorded in
 * the index (ADR-0009), so switching to semantic embeddings is a rebuild,
 * not a code change: `EMBED_PROVIDER=workers-ai pnpm kb:refresh` (with
 * `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN`, for the Cloudflare
 * Worker) or `EMBED_PROVIDER=bedrock-titan pnpm kb:refresh` (for the
 * reference AWS deployment).
 *
 * Orchestration only: loading is `support-articles.ts`, the chunk/embed
 * step is the pure, unit-tested `buildKnowledgeIndex`.
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
