---
status: accepted
---

# The SPA is built on Tailwind CSS v4 and Radix primitives

Supersedes ADR-0023. The SPA no longer uses a third-party admin design system. It is built on Tailwind CSS v4 and Radix primitives (`@radix-ui/react-dialog`, `react-tabs`, `react-tooltip`), with a small set of local components in `web/src/components/ui/` and semantic color tokens in `web/src/index.css`. The principle from ADR-0023 still applies: pages compose those shared components and tokens instead of hand-rolled markup and one-off colors. Bespoke pieces such as the onboarding flow diagram and the evidence ledger use the same tokens and native elements.
