import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const LOCAL_INVESTIGATIONS_API_URL = 'http://localhost:8787';

// The dev server proxies `/investigations` to the local Investigations API
// (`pnpm dev serve`) rather than the SPA calling `http://localhost:8787`
// directly from the browser — the API sets no CORS headers locally (the
// project's security requirements scope "CORS locked to CloudFront domain" to the
// deployed stack, not local dev), so a direct cross-origin fetch from
// Vite's own origin fails with "Failed to fetch" before any request even
// reaches the server. Proxying makes the browser's request same-origin
// instead of requiring backend changes this ticket has no reason to make.
// See `docs/adr/0014` for the fuller trade-off. Prod: `VITE_API_URL` is set
// to the real deployed URL. See ADR-0041 for why the SPA's own browser
// location for this resource is `#/investigations/:id`, never a real path
// here.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      '/investigations': LOCAL_INVESTIGATIONS_API_URL,
    },
  },
});
