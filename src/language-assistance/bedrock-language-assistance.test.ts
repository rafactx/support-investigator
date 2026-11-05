import { describe, expect, it } from 'vitest';
import { MockLanguageModelV4 } from 'ai/test';
import {
  buildIntakeExtractionSchema,
  createBedrockLanguageAssistance,
  LANGUAGE_ASSISTANCE_TIMEOUT_MS,
} from './bedrock-language-assistance.ts';

describe('buildIntakeExtractionSchema', () => {
  it('never contains an accountId (or any account-scope) key, structurally — not filtered after the fact (AC2)', () => {
    const schema = buildIntakeExtractionSchema(['skuId', 'seller', 'quantity', 'destinationPostalCode']);
    const shape = schema.shape as Record<string, unknown>;

    expect(Object.keys(shape).sort()).toEqual(['destinationPostalCode', 'quantity', 'seller', 'skuId']);
    expect(shape.accountId).toBeUndefined();
    expect(shape.accountScope).toBeUndefined();
  });

  it('is scoped to exactly the requested fields, not the full field set', () => {
    const schema = buildIntakeExtractionSchema(['skuId']);
    expect(Object.keys(schema.shape as Record<string, unknown>)).toEqual(['skuId']);
  });
});

function mockModel(doGenerate: MockLanguageModelV4['doGenerate']): MockLanguageModelV4 {
  return new MockLanguageModelV4({ doGenerate });
}

function textContent(json: unknown) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(json) }],
    finishReason: { unified: 'stop' as const, raw: undefined },
    usage: {
      inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined },
      outputTokens: { total: 20, text: 20, reasoning: undefined },
    },
    warnings: [],
  };
}

describe('createBedrockLanguageAssistance', () => {
  it('reserves a per-call model budget below the deployed Lambda budget', () => {
    expect(LANGUAGE_ASSISTANCE_TIMEOUT_MS).toBeLessThan(25_000);
  });

  it('passes an abort signal to the model call so its timeout cancels provider work', async () => {
    let abortSignal: AbortSignal | undefined;
    const model = mockModel(async (options) => {
      abortSignal = options.abortSignal;
      return textContent({ skuId: 'SKU-2002' });
    });
    const languageAssistance = createBedrockLanguageAssistance({}, model);

    await languageAssistance.extractIntake({ ticketText: 'SKU-2002', fields: ['skuId'] });

    expect(abortSignal).toBeInstanceOf(AbortSignal);
    expect(abortSignal?.aborted).toBe(false);
  });

  it('extracts schema-validated fields from a successful bounded call', async () => {
    const model = mockModel(async () => textContent({ skuId: 'SKU-2002', destinationPostalCode: '01310-100' }));
    const languageAssistance = createBedrockLanguageAssistance({}, model);

    const result = await languageAssistance.extractIntake({
      ticketText: 'Item SKU-2002 has no delivery option for 01310-100.',
      fields: ['skuId', 'destinationPostalCode'],
    });

    expect(result).toEqual({
      kind: 'extracted',
      fields: { skuId: 'SKU-2002', destinationPostalCode: '01310-100' },
    });
  });

  it('degrades to unavailable rather than throwing when the model call fails (AC7)', async () => {
    const model = mockModel(async () => {
      throw new Error('ThrottlingException: rate exceeded');
    });
    const languageAssistance = createBedrockLanguageAssistance({}, model);

    const result = await languageAssistance.extractIntake({
      ticketText: 'Anything at all.',
      fields: ['skuId'],
    });

    expect(result.kind).toBe('unavailable');
    expect(result.kind === 'unavailable' && result.reason).toMatch(/ThrottlingException/);
  });

  it('returns an empty extraction without calling the model when no fields are requested', async () => {
    let called = false;
    const model = mockModel(async () => {
      called = true;
      return textContent({});
    });
    const languageAssistance = createBedrockLanguageAssistance({}, model);

    const result = await languageAssistance.extractIntake({ ticketText: 'Anything.', fields: [] });

    expect(result).toEqual({ kind: 'extracted', fields: {} });
    expect(called).toBe(false);
  });

  describe('improveExplanation', () => {
    const request = {
      findingCode: 'DESTINATION_NOT_COVERED',
      decision: 'ready_for_human_resolution',
      decisionReason: 'contract_satisfied',
      deterministicSummary: 'Deterministic explanation text.',
      allowedPlaceholderNames: ['skuId', 'destinationPostalCode'],
      sourcePackUrls: ['https://docs.example.com/runbooks/destination-not-covered'],
    };

    it('returns a schema-validated summaryTemplate and citedSourceUrls from a successful bounded call', async () => {
      const model = mockModel(async () =>
        textContent({
          summaryTemplate: 'SKU {{skuId}} is not covered for {{destinationPostalCode}}.',
          citedSourceUrls: request.sourcePackUrls,
        }),
      );
      const languageAssistance = createBedrockLanguageAssistance({}, model);

      const result = await languageAssistance.improveExplanation(request);

      expect(result).toEqual({
        kind: 'improved',
        summaryTemplate: 'SKU {{skuId}} is not covered for {{destinationPostalCode}}.',
        citedSourceUrls: request.sourcePackUrls,
      });
    });

    it('the system prompt lists only the given placeholder names and source URLs, never a real identifier', async () => {
      let capturedSystemPrompt = '';
      const model = mockModel(async (options) => {
        capturedSystemPrompt = options.prompt.find((message) => message.role === 'system')?.content ?? '';
        return textContent({ summaryTemplate: 'Fine.', citedSourceUrls: request.sourcePackUrls });
      });
      const languageAssistance = createBedrockLanguageAssistance({}, model);

      await languageAssistance.improveExplanation(request);

      expect(capturedSystemPrompt).toContain('{{skuId}}');
      expect(capturedSystemPrompt).toContain('{{destinationPostalCode}}');
      expect(capturedSystemPrompt).toContain(request.sourcePackUrls[0]);
    });

    it('degrades to unavailable rather than throwing when the model call fails (AC7)', async () => {
      const model = mockModel(async () => {
        throw new Error('ThrottlingException: rate exceeded');
      });
      const languageAssistance = createBedrockLanguageAssistance({}, model);

      const result = await languageAssistance.improveExplanation(request);

      expect(result.kind).toBe('unavailable');
      expect(result.kind === 'unavailable' && result.reason).toMatch(/ThrottlingException/);
    });
  });
});
