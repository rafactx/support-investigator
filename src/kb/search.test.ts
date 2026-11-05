import { describe, expect, it } from 'vitest';
import { createBedrockTitanEmbedProvider } from './embeddings/bedrock-titan-embed-provider.ts';
import { createLexicalEmbedProvider } from './embeddings/lexical-embed-provider.ts';
import { fixtureKnowledgeIndex } from './fixtures/knowledge-index.fixture.ts';
import { searchSupportKnowledge } from './search.ts';

// Independent source of truth: the knowledge-base requirement — "search_support_knowledge
// (query, limit) exposed over Support MCP, returns results[] with
// title/url/excerpt/score via in-memory cosine similarity over the frozen
// index" and "unit tests cover retrieval relevance for at least 2-3
// representative queries against the frozen fixture index" (AC 3, AC 5).

describe('searchSupportKnowledge', () => {
  it('ranks the delivery-options doc first for a NO_DELIVERY_OPTIONS-style query', async () => {
    const index = await fixtureKnowledgeIndex();

    const results = await searchSupportKnowledge(
      index,
      'SKU has stock but no delivery option, shipping coverage',
      1,
      createLexicalEmbedProvider()
    );

    expect(results[0]?.title).toBe('Delivery options and SLAs');
  });

  it('ranks the payment-denial doc first for a payment-denied query', async () => {
    const index = await fixtureKnowledgeIndex();

    const results = await searchSupportKnowledge(
      index,
      'payment denied by card issuer insufficient funds',
      1,
      createLexicalEmbedProvider()
    );

    expect(results[0]?.title).toBe('Payment status and denial reasons');
  });

  it('ranks the order-cancellation doc first for a cancellation query', async () => {
    const index = await fixtureKnowledgeIndex();

    const results = await searchSupportKnowledge(
      index,
      'cancel order before invoicing',
      1,
      createLexicalEmbedProvider()
    );

    expect(results[0]?.title).toBe('Order cancellation flow');
  });

  it('returns results[] shaped as title/url/excerpt/score, honoring limit', async () => {
    const index = await fixtureKnowledgeIndex();

    const results = await searchSupportKnowledge(index, 'order', 2, createLexicalEmbedProvider());

    expect(results.length).toBeLessThanOrEqual(2);
    for (const result of results) {
      expect(typeof result.title).toBe('string');
      expect(typeof result.url).toBe('string');
      expect(typeof result.excerpt).toBe('string');
      expect(typeof result.score).toBe('number');
    }
  });

  it('returns results sorted by descending score', async () => {
    const index = await fixtureKnowledgeIndex();

    const results = await searchSupportKnowledge(index, 'order', 3, createLexicalEmbedProvider());

    const scores = results.map((r) => r.score);
    expect(scores).toEqual([...scores].sort((a, b) => b - a));
  });

  it('rejects querying a lexical-built index with a mismatched embed provider (ADR-0009)', async () => {
    const index = await fixtureKnowledgeIndex();

    await expect(
      searchSupportKnowledge(index, 'order', 1, createBedrockTitanEmbedProvider({}))
    ).rejects.toThrow();
  });
});
