import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-plugin';
import { defineConfig } from 'vitest/config';

/**
 * Runs `*.workers.test.ts` inside workerd through Miniflare: a local D1
 * database with this repository's migrations applied, `nodejs_compat` as in
 * wrangler.jsonc, and no remote bindings, so the suite needs no Cloudflare
 * account and makes no network calls. Rate-limit bindings and Workers AI
 * are replaced by fakes inside the tests.
 */
export default defineConfig({
  plugins: [
    cloudflareTest(async () => ({
      miniflare: {
        compatibilityDate: '2026-10-23',
        compatibilityFlags: ['nodejs_compat'],
        d1Databases: ['DB'],
        bindings: {
          TEST_MIGRATIONS: await readD1Migrations(new URL('./migrations', import.meta.url).pathname),
        },
      },
    })),
  ],
  test: {
    name: 'workers',
    include: ['src/**/*.workers.test.ts'],
    setupFiles: ['./src/cloudflare/test/apply-migrations.ts'],
  },
});
