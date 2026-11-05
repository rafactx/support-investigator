import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseKnowledgeIndex } from './parse-index.ts';
import type { KnowledgeIndex } from './types.ts';

/** The frozen, git-committed `KnowledgeIndex` `pnpm kb:refresh` produces. */
export const DEFAULT_INDEX_PATH = fileURLToPath(new URL('./data/index.json', import.meta.url));

/**
 * Reads and validates the frozen `KnowledgeIndex` at `path` (default: the
 * committed `src/kb/data/index.json`) on Node: the CLI and the reference
 * Lambda. It is never mutated and never fetched over the network at
 * runtime; only `pnpm kb:refresh` rebuilds it.
 */
export function loadKnowledgeIndex(path: string = DEFAULT_INDEX_PATH): KnowledgeIndex {
  let raw: string;
  try {
    raw = readFileSync(path, 'utf-8');
  } catch (error) {
    throw new Error(
      `loadKnowledgeIndex: could not read "${path}" — run "pnpm kb:refresh" first`,
      { cause: error }
    );
  }

  return parseKnowledgeIndex(JSON.parse(raw), path);
}
