import { createBedrockLanguageAssistance } from './bedrock-language-assistance.ts';
import { createFakeLanguageAssistance, fixedFieldsScript } from './fake-language-assistance.ts';
import { type LanguageModelProvider, parseLanguageModelProvider } from './language-model-provider.ts';
import { readLanguageAssistanceTimeoutMs } from './model-language-assistance.ts';
import type { LanguageAssistance } from './types.ts';
import { unavailableLanguageAssistance } from './unavailable-language-assistance.ts';
import {
  createWorkersAiLanguageAssistance,
  readWorkersAiRestAccess,
  type WorkersAiAccess,
} from './workers-ai-language-assistance.ts';

/**
 * Selects Language Assistance by `LANGUAGE_MODEL_PROVIDER`:
 *
 * - `bedrock` — Amazon Bedrock; the reference AWS deployment's default.
 * - `workers-ai` — Cloudflare Workers AI; the live demo's default. Node
 *   scripts reach it over REST with `CLOUDFLARE_ACCOUNT_ID` and
 *   `CLOUDFLARE_API_TOKEN`; the Worker passes its `AI` binding instead
 *   (`src/cloudflare/worker-language-assistance.ts`).
 * - `fake` — never proposes anything and reports explanation improvement
 *   as unavailable, so every flow degrades to the deterministic path with
 *   zero network calls.
 *
 * Construction never calls a model, so selecting a provider without
 * credentials is safe; the first call simply reports `unavailable`. Another
 * hosted model is one `LanguageModel` passed to
 * `createModelLanguageAssistance` plus one case here.
 */
export function createLanguageAssistance(
  env: NodeJS.ProcessEnv = process.env,
  defaultProvider: LanguageModelProvider = 'fake',
  workersAiAccess: WorkersAiAccess | undefined = readWorkersAiRestAccess(env),
): { provider: LanguageModelProvider; languageAssistance: LanguageAssistance } {
  const provider = parseLanguageModelProvider(env.LANGUAGE_MODEL_PROVIDER, defaultProvider);
  switch (provider) {
    case 'bedrock':
      return { provider, languageAssistance: createBedrockLanguageAssistance(env) };
    case 'workers-ai':
      return {
        provider,
        languageAssistance: workersAiAccess
          ? createWorkersAiLanguageAssistance({
              access: workersAiAccess,
              modelId: env.WORKERS_AI_MODEL,
              timeoutMs: readLanguageAssistanceTimeoutMs(env.LANGUAGE_ASSISTANCE_TIMEOUT_MS),
            })
          : unavailableLanguageAssistance('Workers AI needs CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN'),
      };
    case 'fake':
      return { provider, languageAssistance: createFakeLanguageAssistance(fixedFieldsScript({})) };
  }
}
