import committedIndex from './data/index.json' with { type: 'json' };
import { parseKnowledgeIndex } from './parse-index.ts';
import type { KnowledgeIndex } from './types.ts';

let cached: KnowledgeIndex | undefined;

/**
 * The committed `src/kb/data/index.json`, imported as a module so a bundler
 * inlines it. Runtimes without a filesystem (the Cloudflare Worker) use this
 * instead of `loadKnowledgeIndex()`. It is validated once per isolate, with
 * the same schema check as the file reader.
 */
export function loadBundledKnowledgeIndex(): KnowledgeIndex {
  cached ??= parseKnowledgeIndex(committedIndex, 'src/kb/data/index.json (bundled)');
  return cached;
}
