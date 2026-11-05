import { describe, expect, it } from 'vitest';
import { buildQueryEmbedEnv, createQueryEmbedProvider } from './query-embed-provider.ts';

// Regression test for a bug found live on the reference AWS deployment:
// the query embedder used to be built from a fresh
// `{ EMBED_PROVIDER: index.provider }` object, discarding every other env
// var, including `AWS_REGION`. Outside `us-east-1` that silently made the
// Bedrock Titan provider call the wrong region and fail with
// `AccessDeniedException`. `buildQueryEmbedEnv` is the directly testable
// fix: every other env var passes through unchanged, only `EMBED_PROVIDER`
// is forced to the frozen index's own provider (ADR-0009).
describe('buildQueryEmbedEnv', () => {
  it('preserves every other env var (e.g. AWS_REGION) while overriding EMBED_PROVIDER to the index provider', () => {
    const env = { AWS_REGION: 'us-east-2', EMBED_PROVIDER: 'lexical', SOME_OTHER_VAR: 'kept' };

    const result = buildQueryEmbedEnv(env, { provider: 'bedrock-titan' });

    expect(result).toEqual({
      AWS_REGION: 'us-east-2',
      EMBED_PROVIDER: 'bedrock-titan',
      SOME_OTHER_VAR: 'kept',
    });
  });

  it('still overrides EMBED_PROVIDER even when the ambient env has none set', () => {
    const result = buildQueryEmbedEnv({}, { provider: 'lexical' });

    expect(result).toEqual({ EMBED_PROVIDER: 'lexical' });
  });
});

describe('createQueryEmbedProvider', () => {
  it('queries with the provider recorded in the index, ignoring the ambient EMBED_PROVIDER', () => {
    const provider = createQueryEmbedProvider({ provider: 'lexical' }, { EMBED_PROVIDER: 'bedrock-titan' });
    expect(provider.id).toBe('lexical');
  });
});
