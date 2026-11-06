import { describe, expect, it } from 'vitest';
import { chunkText } from './chunk.ts';

// The knowledge-base pipeline chunks documents before embedding them into
// the frozen index.json. No exact chunk size is part of that contract, so
// these tests assert the properties any reasonable chunker must
// hold (no data lost, no oversized chunk, no empty chunk) rather than a
// specific chunk count derived from the implementation itself.

describe('chunkText', () => {
  it('returns the whole text as one chunk when it fits under maxChars', () => {
    const text = 'Orders can be canceled before invoicing.';

    const chunks = chunkText(text, { maxChars: 500 });

    expect(chunks).toEqual([text]);
  });

  it('splits long text into multiple chunks, each within maxChars', () => {
    const paragraph =
      'The order flow describes the status, possibilities, and actions throughout the life cycle of an order. ';
    const longText = paragraph.repeat(20).trim();

    const chunks = chunkText(longText, { maxChars: 200 });

    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(200);
      expect(chunk.trim().length).toBeGreaterThan(0);
    }
  });

  it('does not silently drop content from the source text', () => {
    const longText = Array.from({ length: 10 }, (_, i) => `Sentence number ${i}.`).join(' ');

    const chunks = chunkText(longText, { maxChars: 40 });

    for (let i = 0; i < 10; i++) {
      expect(chunks.some((chunk) => chunk.includes(`Sentence number ${i}.`))).toBe(true);
    }
  });

  it('returns no chunks for empty or whitespace-only input', () => {
    expect(chunkText('', { maxChars: 200 })).toEqual([]);
    expect(chunkText('   \n  ', { maxChars: 200 })).toEqual([]);
  });
});
