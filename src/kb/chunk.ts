export interface ChunkOptions {
  /** Maximum characters per chunk. */
  maxChars: number;
}

/**
 * Splits `text` into word-boundary chunks no longer than `maxChars`. Pure,
 * no I/O — the seam `buildKnowledgeIndex` composes with a fetched document
 * body before embedding (`kb:refresh`).
 *
 * Splits on whitespace so words are never cut mid-token, and returns `[]`
 * for empty/whitespace-only input rather than `['']`.
 */
export function chunkText(text: string, { maxChars }: ChunkOptions): string[] {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) {
    return [];
  }

  const chunks: string[] = [];
  let current = '';

  for (const word of words) {
    const candidate = current.length === 0 ? word : `${current} ${word}`;
    if (candidate.length > maxChars && current.length > 0) {
      chunks.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }
  if (current.length > 0) {
    chunks.push(current);
  }

  return chunks;
}
