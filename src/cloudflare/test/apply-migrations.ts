import { applyD1Migrations } from 'cloudflare:test';
import { env } from 'cloudflare:workers';

// Every Workers test file gets its own isolated D1 storage; apply the real
// migrations (`migrations/*.sql`) to it before any test runs.
await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
