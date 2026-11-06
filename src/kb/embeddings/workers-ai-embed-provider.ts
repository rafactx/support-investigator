import { embedMany } from 'ai';
import { createWorkersAi, type WorkersAiAccess } from '../../platform/workers-ai.ts';
import type { EmbedProvider } from './embed-provider.ts';

/**
 * BGE-M3: multilingual (tickets arrive in Portuguese and English), 1,024
 * dense dimensions, and the cheapest Workers AI embedding per token.
 * Override with `WORKERS_AI_EMBED_MODEL`.
 */
const DEFAULT_WORKERS_AI_EMBED_MODEL = '@cf/baai/bge-m3';

/** Output size of each supported Workers AI embedding model; the index records it (ADR-0009). */
const WORKERS_AI_EMBED_DIMENSIONS: Readonly<Record<string, number>> = {
  '@cf/baai/bge-m3': 1024,
  '@cf/baai/bge-large-en-v1.5': 1024,
  '@cf/baai/bge-base-en-v1.5': 768,
  '@cf/baai/bge-small-en-v1.5': 384,
};

export type EmbedTexts = (model: string, texts: string[]) => Promise<number[][]>;

export interface WorkersAiEmbedProviderOptions {
  /** The `AI` binding in a Worker, REST credentials on Node. Ignored when `embedTexts` is given. */
  readonly access?: WorkersAiAccess;
  readonly model?: string;
  /** Injected in tests; defaults to AI SDK `embedMany` over Workers AI. */
  readonly embedTexts?: EmbedTexts;
}

function embedWithWorkersAi(access: WorkersAiAccess | undefined): EmbedTexts {
  return async (model, texts) => {
    if (!access) {
      throw new Error(
        'EMBED_PROVIDER=workers-ai needs CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN outside a Worker',
      );
    }
    const { embeddings } = await embedMany({ model: createWorkersAi(access).embedding(model as `@cf/${string}`), values: texts });
    return embeddings;
  };
}

/**
 * `EMBED_PROVIDER=workers-ai` — Cloudflare Workers AI text embeddings. Used
 * at `kb:refresh` time over the REST API and, once the committed index was
 * built with it, at query time through the Worker's `AI` binding. Every
 * vector's length is checked, so a model swap without a rebuild fails
 * loudly instead of scoring vectors from two different spaces.
 */
export function createWorkersAiEmbedProvider(options: WorkersAiEmbedProviderOptions = {}): EmbedProvider {
  const model = options.model?.trim() || DEFAULT_WORKERS_AI_EMBED_MODEL;
  const dimensions = WORKERS_AI_EMBED_DIMENSIONS[model];
  if (!dimensions) {
    throw new Error(
      `Unsupported WORKERS_AI_EMBED_MODEL "${model}" — expected one of ${Object.keys(WORKERS_AI_EMBED_DIMENSIONS).join(', ')}`,
    );
  }
  const embedTexts = options.embedTexts ?? embedWithWorkersAi(options.access);

  return {
    id: 'workers-ai',
    model,
    dimensions,
    async embed(texts: string[]): Promise<number[][]> {
      if (texts.length === 0) return [];
      const vectors = await embedTexts(model, texts);
      if (vectors.length !== texts.length || vectors.some((vector) => vector.length !== dimensions)) {
        throw new Error(`Workers AI model "${model}" returned vectors that are not ${texts.length} × ${dimensions}`);
      }
      return vectors;
    },
  };
}
