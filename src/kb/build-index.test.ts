import { describe, expect, it } from 'vitest';
import { buildKnowledgeIndex } from './build-index.ts';
import { createLexicalEmbedProvider } from './embeddings/lexical-embed-provider.ts';
import { KnowledgeIndexSchema } from './types.ts';

// Independent source of truth: the knowledge-base requirement — "chunks and
// embeds them into a frozen index.json ... committed to git" and
// "provider swappable via EMBED_PROVIDER". `buildKnowledgeIndex` is the
// pure documents->index step, kept separate from the file I/O that loads
// the support runbooks (`support-articles.ts`) — this test exercises it with hand-built fetched-doc fixtures, no network involved.

describe('buildKnowledgeIndex', () => {
  it('produces a KnowledgeIndex matching the schema, recording the embed provider used', async () => {
    const provider = createLexicalEmbedProvider();
    const docs = [
      {
        title: 'Order flow and status',
        url: 'https://docs.example.com/runbooks/order-flow-and-status',
        content: 'Orders can be canceled before invoicing. The order flow describes status.',
      },
    ];

    const index = await buildKnowledgeIndex(docs, provider);

    expect(KnowledgeIndexSchema.safeParse(index).success).toBe(true);
    expect(index.provider).toBe('lexical');
    expect(index.model).toBe(provider.model);
    expect(index.dimensions).toBe(provider.dimensions);
  });

  it('produces one or more chunks per doc, each carrying the doc title/url and an embedding', async () => {
    const provider = createLexicalEmbedProvider();
    const docs = [
      {
        title: 'Cart Simulation',
        url: 'https://docs.example.com/runbooks/cart-simulation',
        content: 'Simulates a cart to return SLAs, price, and availability for a SKU.',
      },
    ];

    const index = await buildKnowledgeIndex(docs, provider);

    expect(index.chunks.length).toBeGreaterThanOrEqual(1);
    for (const chunk of index.chunks) {
      expect(chunk.title).toBe('Cart Simulation');
      expect(chunk.url).toBe('https://docs.example.com/runbooks/cart-simulation');
      expect(chunk.embedding).toHaveLength(provider.dimensions);
      expect(chunk.excerpt.length).toBeGreaterThan(0);
    }
  });

  it('assigns each chunk a unique id', async () => {
    const provider = createLexicalEmbedProvider();
    const docs = [
      { title: 'Doc A', url: 'https://example.com/a', content: 'content a' },
      { title: 'Doc B', url: 'https://example.com/b', content: 'content b' },
    ];

    const index = await buildKnowledgeIndex(docs, provider);

    const ids = index.chunks.map((chunk) => chunk.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
