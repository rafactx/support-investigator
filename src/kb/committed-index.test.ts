import { describe, expect, it } from 'vitest';
import { loadBundledKnowledgeIndex } from './bundled-index.ts';
import { loadKnowledgeIndex } from './load-index.ts';
import { loadSupportArticles } from './support-articles.ts';

// Independent source of truth: the knowledge base requirement that
// `pnpm kb:refresh` produces a versioned index.json of 12-20 curated runbooks,
// chunked. This is
// the only test that loads the actual committed `src/kb/data/index.json`
// (the real deliverable `pnpm kb:refresh` produced from the runbooks in
// `src/kb/articles/`) — every other test in this directory exercises the
// pure pipeline against fixtures. Zero network:
// this reads the file already committed to git, it does not call
// `kb:refresh` or any embedding provider.

describe('the committed Knowledge Index (src/kb/data/index.json)', () => {
  it('is schema-valid and versioned (loadKnowledgeIndex validates on read)', () => {
    expect(() => loadKnowledgeIndex()).not.toThrow();
    const index = loadKnowledgeIndex();
    expect(typeof index.builtAt).toBe('string');
    expect(index.chunks.length).toBeGreaterThan(0);
  });

  it('contains between 12 and 20 runbooks, one title per committed article', () => {
    const index = loadKnowledgeIndex();
    const articles = loadSupportArticles();

    const titlesInIndex = new Set(index.chunks.map((chunk) => chunk.title));
    expect(titlesInIndex.size).toBeGreaterThanOrEqual(12);
    expect(titlesInIndex.size).toBeLessThanOrEqual(20);
    expect(titlesInIndex.size).toBe(articles.length);

    for (const article of articles) {
      expect(titlesInIndex.has(article.title)).toBe(true);
    }
  });

  it('is in sync with the runbook sources: every chunk is a verbatim slice of its article (rerun pnpm kb:refresh after editing articles)', () => {
    const index = loadKnowledgeIndex();
    const normalizedContentByUrl = new Map(
      loadSupportArticles().map((article) => [article.url, article.content.trim().split(/\s+/).join(' ')]),
    );

    for (const chunk of index.chunks) {
      expect(normalizedContentByUrl.get(chunk.url)).toContain(chunk.text);
    }
  });

  it('every chunk carries an embedding matching the index-declared dimensions', () => {
    const index = loadKnowledgeIndex();

    for (const chunk of index.chunks) {
      expect(chunk.embedding).toHaveLength(index.dimensions);
    }
  });

  it('is exactly what the Cloudflare Worker bundles (the module import and the file read agree)', () => {
    expect(loadBundledKnowledgeIndex()).toEqual(loadKnowledgeIndex());
  });
});
