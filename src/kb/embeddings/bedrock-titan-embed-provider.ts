import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';
import type { EmbedProvider } from './embed-provider.ts';

/** Titan Embeddings is invoked by model id; it needs no inference profile. */
const DEFAULT_MODEL_ID = 'amazon.titan-embed-text-v2:0';
const DIMENSIONS = 256;

interface TitanEmbedResponse {
  embedding: number[];
}

/**
 * `EMBED_PROVIDER=bedrock-titan` — Bedrock Titan
 * Embeddings v2, one `InvokeModel` call per text. Used both at
 * `kb:refresh` build time (embeds curated docs) and at runtime by
 * `search_support_knowledge` (embeds the query with the same
 * provider/model the frozen index was built with — ADR-0009).
 */
export function createBedrockTitanEmbedProvider(
  env: NodeJS.ProcessEnv = process.env
): EmbedProvider {
  const client = new BedrockRuntimeClient({ region: env.AWS_REGION ?? 'us-east-1' });
  const modelId = env.EMBED_MODEL_ID ?? DEFAULT_MODEL_ID;

  return {
    id: 'bedrock-titan',
    model: modelId,
    dimensions: DIMENSIONS,
    async embed(texts: string[]): Promise<number[][]> {
      const vectors: number[][] = [];
      for (const text of texts) {
        const command = new InvokeModelCommand({
          modelId,
          contentType: 'application/json',
          accept: 'application/json',
          body: JSON.stringify({ inputText: text, dimensions: DIMENSIONS, normalize: true }),
        });
        const response = await client.send(command);
        const parsed = JSON.parse(
          new TextDecoder().decode(response.body)
        ) as TitanEmbedResponse;
        vectors.push(parsed.embedding);
      }
      return vectors;
    },
  };
}
