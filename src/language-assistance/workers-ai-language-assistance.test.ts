import { MockLanguageModelV4 } from 'ai/test';
import { describe, expect, it } from 'vitest';
import {
  INTAKE_EXTRACTION_MAX_OUTPUT_TOKENS,
  LANGUAGE_ASSISTANCE_TIMEOUT_MS,
  MAX_LANGUAGE_ASSISTANCE_TIMEOUT_MS,
  readLanguageAssistanceTimeoutMs,
} from './model-language-assistance.ts';
import { createWorkersAiLanguageAssistance, DEFAULT_WORKERS_AI_MODEL } from './workers-ai-language-assistance.ts';

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

describe('createWorkersAiLanguageAssistance', () => {
  it('defaults to an instruction-following Workers AI model with JSON Mode support', () => {
    expect(DEFAULT_WORKERS_AI_MODEL).toBe('@cf/meta/llama-3.3-70b-instruct-fp8-fast');
  });

  it('runs the shared bounded call: token ceiling, structured JSON output and an abort signal', async () => {
    let call: { maxOutputTokens?: number; abortSignal?: AbortSignal; responseFormat?: { type: string } } = {};
    const model = new MockLanguageModelV4({
      doGenerate: async (options) => {
        call = options;
        return textContent({ skuId: 'SKU-2002' });
      },
    });
    const languageAssistance = createWorkersAiLanguageAssistance({ access: { binding: {} }, model });

    const result = await languageAssistance.extractIntake({ ticketText: 'SKU-2002', fields: ['skuId'] });

    expect(result).toEqual({ kind: 'extracted', fields: { skuId: 'SKU-2002' } });
    expect(call.maxOutputTokens).toBe(INTAKE_EXTRACTION_MAX_OUTPUT_TOKENS);
    expect(call.responseFormat?.type).toBe('json');
    expect(call.abortSignal).toBeInstanceOf(AbortSignal);
  });

  it('reports a model failure as unavailable rather than throwing', async () => {
    const model = new MockLanguageModelV4({
      doGenerate: async () => {
        throw new Error('3036: account limited');
      },
    });
    const languageAssistance = createWorkersAiLanguageAssistance({ access: { binding: {} }, model });

    await expect(
      languageAssistance.extractIntake({ ticketText: 'SKU-2002', fields: ['skuId'] }),
    ).resolves.toMatchObject({ kind: 'unavailable' });
  });

  it('aborts a call that outlives the configured timeout', async () => {
    const model = new MockLanguageModelV4({
      doGenerate: (options) =>
        new Promise((_resolve, reject) => {
          options.abortSignal?.addEventListener('abort', () => reject(options.abortSignal?.reason));
        }),
    });
    const languageAssistance = createWorkersAiLanguageAssistance({ access: { binding: {} }, model, timeoutMs: 20 });

    await expect(
      languageAssistance.extractIntake({ ticketText: 'SKU-2002', fields: ['skuId'] }),
    ).resolves.toMatchObject({ kind: 'unavailable' });
  });
});

describe('readLanguageAssistanceTimeoutMs', () => {
  it.each([
    [undefined, LANGUAGE_ASSISTANCE_TIMEOUT_MS],
    ['8000', 8000],
    ['0', LANGUAGE_ASSISTANCE_TIMEOUT_MS],
    ['-5', LANGUAGE_ASSISTANCE_TIMEOUT_MS],
    ['abc', LANGUAGE_ASSISTANCE_TIMEOUT_MS],
    [String(MAX_LANGUAGE_ASSISTANCE_TIMEOUT_MS + 1), LANGUAGE_ASSISTANCE_TIMEOUT_MS],
  ])('reads %s as %i ms, never an unbounded call', (raw, expected) => {
    expect(readLanguageAssistanceTimeoutMs(raw)).toBe(expected);
  });
});
