---
status: superseded by ADR-0050
---

# The SPA composes a design system's real primitives, not a hand-rolled shell

The first SPA used a third-party admin design system's tokens over a hand-rolled page shell (custom `.app__title`/`.field` classes). That looked on-brand through tokens alone while inventing its own structure — the failure mode a design system exists to prevent. The fix was to compose the system's real page, field and link primitives instead of imitating them, keeping only two deliberate exceptions (monospace for technical identifiers, and a small bespoke evidence timeline the system had no component for).

The SPA has since been rebuilt on Tailwind CSS v4 and Radix primitives (ADR-0050).
