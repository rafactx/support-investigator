import { describe, expect, it } from 'vitest';
import { cosineSimilarity } from '../cosine-similarity.ts';
import { createLexicalEmbedProvider } from './lexical-embed-provider.ts';

// The `lexical` provider (the default and the committed index's provider)
// must be a real lexical-overlap embedder, not a per-string random hasher — a
// random hasher would make retrieval-relevance assertions elsewhere
// vacuous (any doc could "win" a query). These tests pin that
// down directly: shared vocabulary must score higher than disjoint
// vocabulary, and the provider must be deterministic (no network, no
// randomness) so CI never flakes.

describe('createLexicalEmbedProvider', () => {
  it('is deterministic — the same text embeds to the same vector every time', async () => {
    const provider = createLexicalEmbedProvider();

    const [first] = await provider.embed(['orders can be canceled before invoicing']);
    const [second] = await provider.embed(['orders can be canceled before invoicing']);

    expect(first).toEqual(second);
  });

  it('produces vectors of the declared dimensions', async () => {
    const provider = createLexicalEmbedProvider();

    const [vector] = await provider.embed(['shipping estimate']);

    expect(vector).toHaveLength(provider.dimensions);
  });

  it('scores shared vocabulary higher than disjoint vocabulary (real lexical-overlap signal)', async () => {
    const provider = createLexicalEmbedProvider();
    const [query] = await provider.embed(['no delivery option shipping policy']);
    const [related] = await provider.embed([
      'a SKU with stock but no delivery option means the shipping policy has no coverage',
    ]);
    const [unrelated] = await provider.embed(['payment was declined by the card issuer']);

    const relatedScore = cosineSimilarity(query as number[], related as number[]);
    const unrelatedScore = cosineSimilarity(query as number[], unrelated as number[]);

    expect(relatedScore).toBeGreaterThan(unrelatedScore);
  });
});
