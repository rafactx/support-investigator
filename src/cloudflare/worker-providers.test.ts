import { describe, expect, it } from 'vitest';
import { createWorkerQueryEmbedProvider } from './worker-embed-provider.ts';
import { createWorkerLanguageAssistance } from './worker-language-assistance.ts';

describe('createWorkerLanguageAssistance', () => {
  it('defaults to workers-ai', () => {
    expect(createWorkerLanguageAssistance({ AI: {} }).provider).toBe('workers-ai');
  });

  it('degrades to unavailable when the AI binding is missing', async () => {
    const { languageAssistance } = createWorkerLanguageAssistance({});
    await expect(languageAssistance.extractIntake({ ticketText: 'SKU-2002', fields: ['skuId'] })).resolves.toMatchObject({
      kind: 'unavailable',
    });
  });

  it('selects the fake provider for local runs', async () => {
    const { provider, languageAssistance } = createWorkerLanguageAssistance({ LANGUAGE_MODEL_PROVIDER: 'fake' });
    expect(provider).toBe('fake');
    await expect(languageAssistance.extractIntake({ ticketText: 'SKU-2002', fields: ['skuId'] })).resolves.toEqual({
      kind: 'extracted',
      fields: {},
    });
  });

  it('rejects bedrock at startup: the Worker never bundles the AWS SDK', () => {
    expect(() => createWorkerLanguageAssistance({ LANGUAGE_MODEL_PROVIDER: 'bedrock' })).toThrow(/not available/);
  });
});

describe('createWorkerQueryEmbedProvider', () => {
  it('queries a lexical index with no binding at all', () => {
    expect(createWorkerQueryEmbedProvider({ provider: 'lexical', model: 'lexical-hashing-bag-of-words-v1' }, undefined).id).toBe(
      'lexical',
    );
  });

  it('queries a workers-ai index with the model recorded in the index', () => {
    const provider = createWorkerQueryEmbedProvider({ provider: 'workers-ai', model: '@cf/baai/bge-base-en-v1.5' }, {});
    expect(provider).toMatchObject({ id: 'workers-ai', model: '@cf/baai/bge-base-en-v1.5', dimensions: 768 });
  });

  it('refuses a workers-ai index without the AI binding, and indexes no Worker can query', () => {
    expect(() => createWorkerQueryEmbedProvider({ provider: 'workers-ai', model: '@cf/baai/bge-m3' }, undefined)).toThrow(
      /AI binding/,
    );
    expect(() =>
      createWorkerQueryEmbedProvider({ provider: 'bedrock-titan', model: 'amazon.titan-embed-text-v2:0' }, {}),
    ).toThrow(/rebuild/);
  });
});
