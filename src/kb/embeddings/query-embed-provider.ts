import type { KnowledgeIndex } from '../types.ts';
import { createEmbedProvider } from './create-embed-provider.ts';
import type { EmbedProvider } from './embed-provider.ts';

/**
 * Builds the env `createEmbedProvider` uses to embed a query: every var in
 * `env` passed through unchanged, with `EMBED_PROVIDER` forced to the
 * frozen index's own `provider` (ADR-0009).
 *
 * It must not build a fresh `{ EMBED_PROVIDER }` object. Discarding the
 * other variables once made the Bedrock Titan provider fall back to its
 * `us-east-1` default inside a Lambda deployed to another region, so a live
 * `search_support_knowledge` call failed with `AccessDeniedException` even
 * though the function's grant was correct for its own region.
 */
export function buildQueryEmbedEnv(
  env: NodeJS.ProcessEnv,
  index: Pick<KnowledgeIndex, 'provider'>,
): NodeJS.ProcessEnv {
  return { ...env, EMBED_PROVIDER: index.provider };
}

/**
 * The Node-side query embedder for a frozen index: the provider recorded in
 * the index, never whatever `EMBED_PROVIDER` says at call time (ADR-0009).
 * The Cloudflare Worker builds its own (`src/cloudflare/worker-embed-provider.ts`)
 * so that this module's Bedrock and transformer imports never reach the
 * Worker bundle.
 */
export function createQueryEmbedProvider(
  index: Pick<KnowledgeIndex, 'provider'>,
  env: NodeJS.ProcessEnv = process.env,
): EmbedProvider {
  return createEmbedProvider(buildQueryEmbedEnv(env, index));
}
