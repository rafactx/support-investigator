import { createAmazonBedrock } from '@ai-sdk/amazon-bedrock';
import type { LanguageModel } from 'ai';
import { createModelLanguageAssistance } from './model-language-assistance.ts';
import type { LanguageAssistance } from './types.ts';

export {
  buildIntakeExtractionSchema,
  LANGUAGE_ASSISTANCE_TIMEOUT_MS,
} from './model-language-assistance.ts';

/** Region-prefixed inference-profile id (ADR-0003) — bare model ids fail Bedrock's throughput validation. */
export const DEFAULT_BEDROCK_MODEL_ID = 'us.anthropic.claude-haiku-4-5-20251001-v1:0';

/**
 * `LANGUAGE_MODEL_PROVIDER=bedrock` — the reference AWS deployment's model
 * (region from `AWS_REGION`, model id from `MODEL_ID`, credentials from the
 * Lambda execution role). A `model` may be injected for tests.
 */
export function createBedrockLanguageAssistance(
  env: NodeJS.ProcessEnv = process.env,
  model?: LanguageModel,
): LanguageAssistance {
  return createModelLanguageAssistance(
    model ?? createAmazonBedrock({ region: env.AWS_REGION ?? 'us-east-1' })(env.MODEL_ID ?? DEFAULT_BEDROCK_MODEL_ID),
  );
}
