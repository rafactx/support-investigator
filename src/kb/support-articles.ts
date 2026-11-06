import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FetchedDoc } from './build-index.ts';

/**
 * The committed support runbooks `pnpm kb:refresh` builds `data/index.json`
 * from: original, short articles written for this project's fictional
 * commerce platform, one markdown file per article under `articles/`.
 * Keeping the corpus in the repo (rather than fetching it) is what makes
 * the frozen index reproducible and content drift reviewable in a diff.
 *
 * The corpus covers the territory the Fulfillment Operational
 * Capabilities operate in (inventory, fulfillment simulation,
 * warehouse/dock/shipping-policy routing, freight coverage) plus adjacent
 * order topics, so `search_support_knowledge` can offer a citation
 * alongside an observation without becoming case evidence or influencing
 * a Finding.
 */
export const SUPPORT_ARTICLES_DIR = fileURLToPath(new URL('./articles/', import.meta.url));

/** Canonical, citable URL prefix for a runbook (a reserved example domain). */
export const SUPPORT_ARTICLE_BASE_URL = 'https://docs.example.com/runbooks/';

/** The canonical URL of the runbook stored as `articles/<slug>.md`. */
function supportArticleUrl(slug: string): string {
  return `${SUPPORT_ARTICLE_BASE_URL}${slug}`;
}

/**
 * Reads every `*.md` runbook in `dir` (sorted by file name, so the index
 * is stable across machines) as a `FetchedDoc`: the title is the first
 * `# ` heading, the URL is derived from the file's slug, and the content
 * is the full markdown body.
 */
export function loadSupportArticles(dir: string = SUPPORT_ARTICLES_DIR): FetchedDoc[] {
  return readdirSync(dir)
    .filter((name) => name.endsWith('.md'))
    .sort()
    .map((name) => {
      const slug = name.slice(0, -'.md'.length);
      const content = readFileSync(join(dir, name), 'utf-8');
      const title = /^# (.+)$/m.exec(content)?.[1]?.trim();
      if (!title) {
        throw new Error(`loadSupportArticles: "${name}" has no "# " title heading`);
      }
      return { title, url: supportArticleUrl(slug), content };
    });
}
