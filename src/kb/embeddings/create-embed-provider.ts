import { EmbedProviderIdSchema } from '../types.ts';
import { createBedrockTitanEmbedProvider } from './bedrock-titan-embed-provider.ts';
import type { EmbedProvider } from './embed-provider.ts';
import { createLexicalEmbedProvider } from './lexical-embed-provider.ts';
import { createLocalEmbedProvider } from './local-embed-provider.ts';
import { readWorkersAiRestAccess } from '../../platform/workers-ai.ts';
import { createWorkersAiEmbedProvider } from './workers-ai-embed-provider.ts';

/**
 * Builds the `EmbedProvider` selected by `EMBED_PROVIDER`: `lexical`
 * (default — deterministic hashing bag-of-words, zero network; the
 * committed index), `bedrock-titan`, `local` (in-process transformer), or
 * `workers-ai` (Cloudflare Workers AI over REST, with
 * `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN` and optionally
 * `WORKERS_AI_EMBED_MODEL`).
 * A new hosted embedder is one more `EmbedProvider` and one more case here.
 * The single switch point — `kb:refresh`
 * and `search_support_knowledge` both go through this rather than picking a
 * provider module directly.
 */
export function createEmbedProvider(env: NodeJS.ProcessEnv = process.env): EmbedProvider {
  const raw = env.EMBED_PROVIDER ?? 'lexical';
  const { data: id, error } = EmbedProviderIdSchema.safeParse(raw);
  if (error) {
    throw new Error(
      `Unrecognized EMBED_PROVIDER "${raw}" — expected one of ${EmbedProviderIdSchema.options.join(', ')}`
    );
  }

  switch (id) {
    case 'lexical':
      return createLexicalEmbedProvider();
    case 'bedrock-titan':
      return createBedrockTitanEmbedProvider(env);
    case 'local':
      return createLocalEmbedProvider();
    case 'workers-ai':
      return createWorkersAiEmbedProvider({
        access: readWorkersAiRestAccess(env),
        model: env.WORKERS_AI_EMBED_MODEL,
      });
  }
}
