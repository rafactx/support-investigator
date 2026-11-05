# The SPA explains itself in an in-app onboarding drawer, not a route or a modal

A first-time visitor, such as a reviewer, would otherwise land on a bare intake form with no context: what the five capabilities check, why a model proposal must be confirmed, what each Investigation Decision means. This ADR records the container and content decisions; `web/src/lib/onboarding-content.tsx` is the single source for the copy.

A new route (`/about`) was rejected: the SPA's only routing is the hash route for the Investigation resource (ADR-0041), and documentation is not an application state worth its own URL. A centered modal was rejected because the content — five tabs, an interactive pipeline diagram, roadmap cards — needs full viewport height. The chosen container is a side sheet (`web/src/components/ui/sheet.tsx`, Radix Dialog) opened from a "How it works" button in the header, with Radix tabs splitting the content into Overview, Pipeline, Decisions, Architecture and Roadmap. The pipeline diagram is click-to-expand, built from native `<button>`s for keyboard and focus semantics.

The sheet auto-opens once per browser on first visit (a `localStorage` flag in `App.tsx`, wrapped in try/catch so blocked storage never breaks rendering) and only via the header button afterwards — the same persisted-preference pattern ADR-0022 uses for the demo key.
