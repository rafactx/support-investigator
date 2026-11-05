import { defineConfig } from 'vitest/config';

/**
 * Two projects, one `pnpm test`:
 *
 * - `node`: every `*.test.ts` except the Workers ones, on Node (the
 *   default for this repository).
 * - `workers`: `*.workers.test.ts`, inside the real Workers runtime with a
 *   local D1 database (`vitest.workers.config.ts`). No network, no account.
 */
export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'node',
          include: ['**/*.test.{ts,tsx}'],
          exclude: ['**/node_modules/**', '**/dist/**', '**/cdk.out/**', '**/.wrangler/**', '**/*.workers.test.ts'],
        },
      },
      './vitest.workers.config.ts',
    ],
  },
});
