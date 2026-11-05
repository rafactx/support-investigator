import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadKnowledgeIndex } from './load-index.ts';
import type { KnowledgeIndex } from './types.ts';

const VALID_INDEX: KnowledgeIndex = {
  builtAt: '2026-01-01T00:00:00.000Z',
  provider: 'lexical',
  model: 'lexical-hashing-bag-of-words-v1',
  dimensions: 4,
  chunks: [
    {
      id: 'doc-0-chunk-0',
      title: 'Test doc',
      url: 'https://example.com/test',
      text: 'test content',
      excerpt: 'test content',
      embedding: [0.1, 0.2, 0.3, 0.4],
    },
  ],
};

let dir: string | undefined;

afterEach(() => {
  if (dir) {
    rmSync(dir, { recursive: true, force: true });
    dir = undefined;
  }
});

describe('loadKnowledgeIndex', () => {
  it('reads and validates a well-formed index.json file', () => {
    dir = mkdtempSync(join(tmpdir(), 'kb-index-'));
    const path = join(dir, 'index.json');
    writeFileSync(path, JSON.stringify(VALID_INDEX));

    const index = loadKnowledgeIndex(path);

    expect(index).toEqual(VALID_INDEX);
  });

  it('throws a clear error when the file does not match the KnowledgeIndex schema', () => {
    dir = mkdtempSync(join(tmpdir(), 'kb-index-'));
    const path = join(dir, 'index.json');
    writeFileSync(path, JSON.stringify({ not: 'a valid index' }));

    expect(() => loadKnowledgeIndex(path)).toThrow();
  });

  it('throws a clear error when the file does not exist', () => {
    expect(() => loadKnowledgeIndex('/nonexistent/path/index.json')).toThrow();
  });
});
