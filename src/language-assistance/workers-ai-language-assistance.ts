import type { LanguageModel } from 'ai';
import { createModelLanguageAssistance, type ModelLanguageAssistanceOptions } from './model-language-assistance.ts';
import { createWorkersAi, type WorkersAiAccess } from '../platform/workers-ai.ts';
import type { LanguageAssistance } from './types.ts';

export { readWorkersAiRestAccess, type WorkersAiAccess } from '../platform/workers-ai.ts';

/**
 * Llama 3.3 70B (fp8, "fast" serving) on Workers AI: an instruction-tuned,
 * non-reasoning model that Cloudflare lists as supporting JSON Mode
 * (`response_format` with a JSON Schema), which `Output.object` relies on.
 * A reasoning model would spend the small output-token ceiling on thinking.
 * Override with `WORKERS_AI_MODEL`.
 */
export const DEFAULT_WORKERS_AI_MODEL = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';

export interface WorkersAiLanguageAssistanceOptions extends ModelLanguageAssistanceOptions {
  readonly access: WorkersAiAccess;
  readonly modelId?: string;
  /** Injected in tests instead of a real Workers AI model. */
  readonly model?: LanguageModel;
}

/**
 * `LANGUAGE_MODEL_PROVIDER=workers-ai` — the Cloudflare live demo's model.
 * Prompts, schemas, the token ceilings and the timeout default all come
 * from `createModelLanguageAssistance`; this only chooses the model.
 */
export function createWorkersAiLanguageAssistance(options: WorkersAiLanguageAssistanceOptions): LanguageAssistance {
  const modelId = options.modelId?.trim() || DEFAULT_WORKERS_AI_MODEL;
  const model = options.model ?? createWorkersAi(options.access).languageModel(modelId);
  return createModelLanguageAssistance(model, { timeoutMs: options.timeoutMs });
}
