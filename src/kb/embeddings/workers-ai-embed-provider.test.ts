import { describe, expect, it } from 'vitest';
import { searchSupportKnowledge } from '../search.ts';
import type { KnowledgeIndex } from '../types.ts';
import { createWorkersAiEmbedProvider, type EmbedTexts } from './workers-ai-embed-provider.ts';

function fakeEmbedTexts(dimensions: number, calls: Array<{ model: string; texts: string[] }> = []): EmbedTexts {
  return async (model, texts) => {
    calls.push({ model, texts });
    return texts.map((text) => {
      const vector = new Array<number>(dimensions).fill(0);
      vector[text.length % dimensions] = 1;
      return vector;
    });
  };
}

describe('createWorkersAiEmbedProvider', () => {
  it('records provider id, model and dimensions so the index pins its embedder (ADR-0009)', () => {
    const provider = createWorkersAiEmbedProvider({ model: '@cf/baai/bge-base-en-v1.5', embedTexts: fakeEmbedTexts(768) });

    expect(provider).toMatchObject({ id: 'workers-ai', model: '@cf/baai/bge-base-en-v1.5', dimensions: 768 });
  });

  it('passes the configured model and every text to Workers AI in one call', async () => {
    const calls: Array<{ model: string; texts: string[] }> = [];
    const provider = createWorkersAiEmbedProvider({ embedTexts: fakeEmbedTexts(1024, calls) });

    const vectors = await provider.embed(['stock without delivery', 'dock policy']);

    expect(vectors).toHaveLength(2);
    expect(calls).toEqual([{ model: '@cf/baai/bge-m3', texts: ['stock without delivery', 'dock policy'] }]);
  });

  it('rejects vectors of the wrong size instead of indexing them', async () => {
    const provider = createWorkersAiEmbedProvider({ embedTexts: fakeEmbedTexts(768) });

    await expect(provider.embed(['text'])).rejects.toThrow(/1 × 1024/);
  });

  it('rejects an unknown model at construction, since its dimensions are unknown', () => {
    expect(() => createWorkersAiEmbedProvider({ model: '@cf/unknown/embedder' })).toThrow(/WORKERS_AI_EMBED_MODEL/);
  });

  it('makes no call for an empty batch', async () => {
    const calls: Array<{ model: string; texts: string[] }> = [];
    const provider = createWorkersAiEmbedProvider({ embedTexts: fakeEmbedTexts(1024, calls) });

    expect(await provider.embed([])).toEqual([]);
    expect(calls).toHaveLength(0);
  });

  it('a workers-ai index can only be queried with the workers-ai provider', async () => {
    const index: KnowledgeIndex = {
      builtAt: '2026-11-05T00:00:00.000Z',
      provider: 'workers-ai',
      model: '@cf/baai/bge-m3',
      dimensions: 1024,
      chunks: [],
    };
    const lexicalLike = { id: 'lexical' as const, model: 'x', dimensions: 1024, embed: async () => [[]] };

    await expect(searchSupportKnowledge(index, 'q', 3, lexicalLike)).rejects.toThrow(/mismatch/);
    await expect(
      searchSupportKnowledge(index, 'q', 3, createWorkersAiEmbedProvider({ embedTexts: fakeEmbedTexts(1024) })),
    ).resolves.toEqual([]);
  });
});
