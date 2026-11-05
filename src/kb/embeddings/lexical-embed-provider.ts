import type { EmbedProvider } from './embed-provider.ts';

const DIMENSIONS = 256;

/** djb2 — a small, stable, dependency-free string hash. */
function hashToken(token: string): number {
  let hash = 5381;
  for (let i = 0; i < token.length; i++) {
    hash = (hash * 33) ^ token.charCodeAt(i);
  }
  return hash >>> 0;
}

/**
 * `EMBED_PROVIDER=lexical` (the default, and the committed index) — a
 * deterministic, zero-network, zero-dependency *lexical* embedder using the
 * hashing trick: each token hashes into one of `DIMENSIONS` buckets and the
 * resulting bag-of-words vector is L2-normalized. It is not a semantic
 * model: cosine similarity here measures shared vocabulary, so "no delivery
 * option" finds runbooks that use those words, not paraphrases. That is an
 * honest, reproducible baseline; rebuilding the index with a semantic
 * provider (e.g. `EMBED_PROVIDER=bedrock-titan pnpm kb:refresh`) is a
 * rebuild, not a code change.
 */
export function createLexicalEmbedProvider(): EmbedProvider {
  return {
    id: 'lexical',
    model: 'lexical-hashing-bag-of-words-v1',
    dimensions: DIMENSIONS,
    async embed(texts: string[]): Promise<number[][]> {
      return texts.map((text) => embedOne(text));
    },
  };
}

function embedOne(text: string): number[] {
  const vector = new Array<number>(DIMENSIONS).fill(0);
  const tokens = text.toLowerCase().match(/[a-z0-9]+/g) ?? [];

  for (const token of tokens) {
    const bucket = hashToken(token) % DIMENSIONS;
    vector[bucket] += 1;
  }

  const magnitude = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
  return magnitude === 0 ? vector : vector.map((value) => value / magnitude);
}
