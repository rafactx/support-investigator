import { describe, expect, it } from 'vitest';
import { createLanguageAssistance } from './create-language-assistance.ts';

describe('createLanguageAssistance', () => {
  it('uses the caller default when LANGUAGE_MODEL_PROVIDER is unset', () => {
    expect(createLanguageAssistance({}, 'bedrock').provider).toBe('bedrock');
    expect(createLanguageAssistance({}).provider).toBe('fake');
  });

  it.each(['bedrock', 'workers-ai', 'fake'] as const)('selects %s explicitly, overriding the default', (provider) => {
    expect(createLanguageAssistance({ LANGUAGE_MODEL_PROVIDER: provider }, provider === 'fake' ? 'bedrock' : 'fake').provider).toBe(provider);
  });

  it('rejects an unknown provider instead of silently falling back', () => {
    expect(() => createLanguageAssistance({ LANGUAGE_MODEL_PROVIDER: 'openai' })).toThrow(/LANGUAGE_MODEL_PROVIDER/);
  });

  it('the fake provider proposes nothing and reports explanation improvement unavailable, with no network', async () => {
    const { languageAssistance } = createLanguageAssistance({ LANGUAGE_MODEL_PROVIDER: 'fake' });

    await expect(
      languageAssistance.extractIntake({ ticketText: 'SKU-2002 to 01310-100', fields: ['skuId'] }),
    ).resolves.toEqual({ kind: 'extracted', fields: {} });
    await expect(
      languageAssistance.improveExplanation({
        findingCode: 'DESTINATION_NOT_COVERED',
        decision: 'ready_for_human_resolution',
        decisionReason: 'contract_satisfied',
        deterministicSummary: 'summary',
        allowedPlaceholderNames: [],
        sourcePackUrls: ['https://example.com'],
      }),
    ).resolves.toMatchObject({ kind: 'unavailable' });
  });

  it('workers-ai without Cloudflare credentials degrades to unavailable instead of failing at startup', async () => {
    const { provider, languageAssistance } = createLanguageAssistance({ LANGUAGE_MODEL_PROVIDER: 'workers-ai' });

    expect(provider).toBe('workers-ai');
    await expect(
      languageAssistance.extractIntake({ ticketText: 'SKU-2002', fields: ['skuId'] }),
    ).resolves.toMatchObject({ kind: 'unavailable', reason: expect.stringMatching(/CLOUDFLARE_API_TOKEN/) });
  });

  it('workers-ai with REST credentials constructs a model client without calling it', () => {
    const { provider } = createLanguageAssistance(
      { LANGUAGE_MODEL_PROVIDER: 'workers-ai', CLOUDFLARE_ACCOUNT_ID: 'account', CLOUDFLARE_API_TOKEN: 'token' },
      'fake',
    );
    expect(provider).toBe('workers-ai');
  });
});
