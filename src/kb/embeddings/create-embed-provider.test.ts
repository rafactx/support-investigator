import { describe, expect, it } from 'vitest';
import { createEmbedProvider } from './create-embed-provider.ts';

describe('createEmbedProvider', () => {
  it('defaults to lexical (the committed index provider) when EMBED_PROVIDER is unset', () => {
    const provider = createEmbedProvider({});

    expect(provider.id).toBe('lexical');
  });

  it('selects lexical when EMBED_PROVIDER=lexical', () => {
    const provider = createEmbedProvider({ EMBED_PROVIDER: 'lexical' });

    expect(provider.id).toBe('lexical');
    expect(provider.model).toBe('lexical-hashing-bag-of-words-v1');
  });

  it('selects local when EMBED_PROVIDER=local', () => {
    const provider = createEmbedProvider({ EMBED_PROVIDER: 'local' });

    expect(provider.id).toBe('local');
  });

  it('selects bedrock-titan when EMBED_PROVIDER=bedrock-titan explicitly', () => {
    const provider = createEmbedProvider({ EMBED_PROVIDER: 'bedrock-titan' });

    expect(provider.id).toBe('bedrock-titan');
  });

  it('selects workers-ai when EMBED_PROVIDER=workers-ai, recording the model and its dimensions, with no network at construction', () => {
    const provider = createEmbedProvider({ EMBED_PROVIDER: 'workers-ai' });

    expect(provider.id).toBe('workers-ai');
    expect(provider.model).toBe('@cf/baai/bge-m3');
    expect(provider.dimensions).toBe(1024);
  });

  it('workers-ai without Cloudflare credentials fails on embed with a clear message, never silently', async () => {
    const provider = createEmbedProvider({ EMBED_PROVIDER: 'workers-ai' });

    await expect(provider.embed(['no delivery option'])).rejects.toThrow(/CLOUDFLARE_ACCOUNT_ID/);
  });

  it('throws for an unrecognized EMBED_PROVIDER value', () => {
    expect(() => createEmbedProvider({ EMBED_PROVIDER: 'fake' })).toThrow();
  });
});
