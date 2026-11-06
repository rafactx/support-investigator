import { z } from 'zod';

/**
 * The values `LANGUAGE_MODEL_PROVIDER` accepts. Kept apart from the
 * factories so a runtime can validate the setting without importing every
 * provider's SDK (the Cloudflare Worker never bundles Bedrock).
 */
const LanguageModelProviderSchema = z.enum(['bedrock', 'workers-ai', 'fake']);
export type LanguageModelProvider = z.infer<typeof LanguageModelProviderSchema>;

export function parseLanguageModelProvider(
  raw: string | undefined,
  defaultProvider: LanguageModelProvider,
): LanguageModelProvider {
  const value = raw?.trim() || defaultProvider;
  const parsed = LanguageModelProviderSchema.safeParse(value);
  if (!parsed.success) {
    throw new Error(
      `Unrecognized LANGUAGE_MODEL_PROVIDER "${value}" — expected one of ${LanguageModelProviderSchema.options.join(', ')}`,
    );
  }
  return parsed.data;
}
