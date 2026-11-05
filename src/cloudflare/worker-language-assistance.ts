import { createFakeLanguageAssistance, fixedFieldsScript } from '../language-assistance/fake-language-assistance.ts';
import { type LanguageModelProvider, parseLanguageModelProvider } from '../language-assistance/language-model-provider.ts';
import { readLanguageAssistanceTimeoutMs } from '../language-assistance/model-language-assistance.ts';
import type { LanguageAssistance } from '../language-assistance/types.ts';
import { unavailableLanguageAssistance } from '../language-assistance/unavailable-language-assistance.ts';
import { createWorkersAiLanguageAssistance } from '../language-assistance/workers-ai-language-assistance.ts';

export interface WorkerLanguageAssistanceEnv {
  readonly AI?: unknown;
  readonly LANGUAGE_MODEL_PROVIDER?: string;
  readonly WORKERS_AI_MODEL?: string;
  readonly LANGUAGE_ASSISTANCE_TIMEOUT_MS?: string;
}

/**
 * The Worker's Language Assistance: `workers-ai` (default, through the `AI`
 * binding) or `fake`. It mirrors `createLanguageAssistance` but imports no
 * Bedrock code, so the AWS SDK never enters the Worker bundle; `bedrock` is
 * rejected at startup rather than failing on the first call.
 */
export function createWorkerLanguageAssistance(env: WorkerLanguageAssistanceEnv): {
  provider: LanguageModelProvider;
  languageAssistance: LanguageAssistance;
} {
  const provider = parseLanguageModelProvider(env.LANGUAGE_MODEL_PROVIDER, 'workers-ai');
  switch (provider) {
    case 'workers-ai':
      return {
        provider,
        languageAssistance: env.AI
          ? createWorkersAiLanguageAssistance({
              access: { binding: env.AI },
              modelId: env.WORKERS_AI_MODEL,
              timeoutMs: readLanguageAssistanceTimeoutMs(env.LANGUAGE_ASSISTANCE_TIMEOUT_MS),
            })
          : unavailableLanguageAssistance('The AI binding is not configured'),
      };
    case 'fake':
      return { provider, languageAssistance: createFakeLanguageAssistance(fixedFieldsScript({})) };
    case 'bedrock':
      throw new Error('LANGUAGE_MODEL_PROVIDER=bedrock is not available in the Cloudflare Worker; use workers-ai or fake');
  }
}
