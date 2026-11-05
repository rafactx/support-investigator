import { Moon, Sun } from 'lucide-react';
import { Button } from './ui/button.tsx';
import { Tooltip } from './ui/tooltip.tsx';

export type Theme = 'light' | 'dark';

/**
 * Header toggle flipping `<html data-theme>` between the light and dark
 * token sets in `index.css` (ADR-0024). Labelled by its "on" state
 * (WRITE-005) with `aria-pressed`, so the icon swap is never the only signal.
 */
export function ThemeToggle({
  theme,
  onToggle,
}: {
  theme: Theme;
  onToggle: () => void;
}) {
  const isDark = theme === 'dark';
  return (
    <Tooltip label={isDark ? 'Switch to light theme' : 'Switch to dark theme'}>
      <Button
        variant="ghost"
        size="icon"
        onClick={onToggle}
        aria-pressed={isDark}
        aria-label="Dark theme"
      >
        {isDark ? <Sun aria-hidden="true" /> : <Moon aria-hidden="true" />}
      </Button>
    </Tooltip>
  );
}
