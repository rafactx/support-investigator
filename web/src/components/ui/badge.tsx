import type { HTMLAttributes } from 'react';
import { cn } from '../../lib/cn.ts';

export type BadgeTone = 'neutral' | 'accent' | 'success' | 'warning' | 'danger';

const TONES: Record<BadgeTone, string> = {
  neutral: 'bg-muted text-fg-muted ring-line',
  accent: 'bg-accent-soft text-accent ring-accent-line',
  success: 'bg-success-soft text-success ring-success-line',
  warning: 'bg-warning-soft text-warning ring-warning-line',
  danger: 'bg-danger-soft text-danger ring-danger-line',
};

/**
 * A compact status label. Never colour-only (A11Y-028): every badge carries
 * text, and status badges add an icon. Stays on one line (TYPE-028).
 */
export function Badge({
  tone = 'neutral',
  className,
  ...props
}: HTMLAttributes<HTMLSpanElement> & { tone?: BadgeTone }) {
  return (
    <span
      className={cn(
        'inline-flex h-6 max-w-full shrink-0 items-center gap-1 whitespace-nowrap rounded-md px-2 text-xs font-medium ring-1 ring-inset',
        '[&_svg]:size-3.5 [&_svg]:shrink-0',
        TONES[tone],
        className,
      )}
      {...props}
    />
  );
}
