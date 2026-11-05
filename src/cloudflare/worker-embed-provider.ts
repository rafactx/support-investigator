import type { EmbedProvider } from '../kb/embeddings/embed-provider.ts';
import { createLexicalEmbedProvider } from '../kb/embeddings/lexical-embed-provider.ts';
import { createWorkersAiEmbedProvider } from '../kb/embeddings/workers-ai-embed-provider.ts';
import type { KnowledgeIndex } from '../kb/types.ts';

/**
 * The Worker's query embedder for the bundled index. Like Node's
 * `createQueryEmbedProvider`, it follows the provider recorded in the index
 * (ADR-0009), and for `workers-ai` also the model. Only providers that run
 * inside a Worker are possible: `lexical` needs nothing, `workers-ai` needs
 * the `AI` binding. An index built with Bedrock or the local transformer
 * must be rebuilt before it can be deployed here.
 */
export function createWorkerQueryEmbedProvider(
  index: Pick<KnowledgeIndex, 'provider' | 'model'>,
  ai: unknown,
): EmbedProvider {
  switch (index.provider) {
    case 'lexical':
      return createLexicalEmbedProvider();
    case 'workers-ai':
      if (!ai) throw new Error('The knowledge index was built with workers-ai, but the AI binding is not configured');
      return createWorkersAiEmbedProvider({ access: { binding: ai }, model: index.model });
    default:
      throw new Error(
        `The knowledge index was built with "${index.provider}", which cannot run in a Worker; rebuild it with EMBED_PROVIDER=workers-ai or lexical`,
      );
  }
}
