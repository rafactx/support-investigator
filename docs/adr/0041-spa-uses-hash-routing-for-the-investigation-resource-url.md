# The SPA reaches a Current Investigation through a hash route, not a path route

`GET /investigations/:id` (ADR-0036) needs a stable, refresh-survivable browser URL, and Vite's dev proxy (ADR-0014) already forwards any request whose path starts with `/investigate` to the local Agent API on `:8787` — proxy keys are matched as string prefixes, so that single existing entry already swallows `/investigations` too. If the SPA's own browser path were `/investigations/:id`, a hard refresh or direct load would hit that proxy and receive the API's JSON instead of falling through to `index.html`, defeating the resource URL's whole purpose before the deployed CloudFront SPA fallback (`support-investigator-stack.ts`'s 403/404 → `index.html` rewrite) is even reached.

The SPA instead renders the Current Investigation from `#/investigations/:id`. The fragment never leaves the browser, so it cannot collide with the dev proxy or need a CloudFront change, while still being stable and bookmarkable: reloading the page re-reads the same fragment and re-fetches `GET /investigations/:id` client-side.

## Consequences

`web/vite.config.ts` keeps a real `/investigations` proxy entry for the API calls themselves (`fetch('/investigations/:id')`), which is a plain proxied path request, not a browser navigation — only the SPA's own displayed location uses the hash form. A future path-based route (e.g. if the SPA ever needs server-rendered deep links) would require either a dedicated non-`/investigate*`-prefixed API mount or explicit proxy/CloudFront rules scoped by exact path rather than prefix.
