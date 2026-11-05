import { describe, expect, it } from 'vitest';
import { loadSupportArticles, SUPPORT_ARTICLE_BASE_URL } from './support-articles.ts';

// Independent source of truth: the knowledge-base requirement — "pnpm kb:refresh ...
// produces a versioned index.json of 12-20 curated docs, chunked" — applied
// to the committed runbook corpus under `src/kb/articles/`.

describe('loadSupportArticles', () => {
  const articles = loadSupportArticles();

  it('has between 12 and 20 runbooks', () => {
    expect(articles.length).toBeGreaterThanOrEqual(12);
    expect(articles.length).toBeLessThanOrEqual(20);
  });

  it('has no duplicate titles or URLs', () => {
    const titles = articles.map((a) => a.title);
    const urls = articles.map((a) => a.url);

    expect(new Set(titles).size).toBe(titles.length);
    expect(new Set(urls).size).toBe(urls.length);
  });

  it('gives every runbook a canonical URL, a title, and non-trivial content', () => {
    for (const article of articles) {
      expect(article.url.startsWith(SUPPORT_ARTICLE_BASE_URL)).toBe(true);
      expect(article.title.length).toBeGreaterThan(0);
      expect(article.content.length).toBeGreaterThan(400);
    }
  });

  it('covers the flagship "stock but no delivery option" case', () => {
    const titles = articles.map((a) => a.title.toLowerCase());

    expect(titles.some((t) => t.includes('no delivery options'))).toBe(true);
    expect(titles.some((t) => t.includes('not covered'))).toBe(true);
  });
});
