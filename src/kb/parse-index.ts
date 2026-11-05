import { type KnowledgeIndex, KnowledgeIndexSchema } from './types.ts';

/**
 * Validates an already-parsed `KnowledgeIndex`. Shared by the Node file reader
 * (`load-index.ts`) and by runtimes with no filesystem, such as the Cloudflare Worker,
 * which bundle `index.json` as a module (`bundled-index.ts`).
 */
export function parseKnowledgeIndex(value: unknown, source = 'knowledge index'): KnowledgeIndex {
  const parsed = KnowledgeIndexSchema.safeParse(value);
  if (!parsed.success) {
    throw new Error(
      `loadKnowledgeIndex: "${source}" does not match the KnowledgeIndex schema: ${parsed.error.message}`
    );
  }
  return parsed.data;
}
