---
status: accepted
---

# The SPA's dark mode is a token-override layer, not per-component rules

The SPA needs a dark mode, and the alternatives were per-component dark rules (which fork every component and rot on each change) or one override layer on semantic tokens. We chose the latter: `web/src/index.css` defines semantic color tokens (canvas, surface, foreground, line, accent, status) once, and re-points them under `:root[data-theme="dark"]`. Every component reads only semantic tokens, so it follows the theme with zero component-level rules; Tailwind's `dark:` variant is bound to the same attribute for the rare case that needs it.

There is exactly one switching mechanism: `data-theme` on `<html>`. An inline script in `web/index.html` sets it before first paint from the saved preference or `prefers-color-scheme` (no flash of the wrong theme); React only mirrors it afterwards (`App.tsx`), suppressing transitions for the frame the theme flips so colors change at once.
