import type { ReactNode } from 'react';
import { CircleAlert, Info, TriangleAlert } from 'lucide-react';
import { cn } from '../../lib/cn.ts';

export type AlertTone = 'info' | 'warning' | 'danger';

const TONES: Record<
  AlertTone,
  { box: string; icon: string; Icon: typeof Info }
> = {
  info: {
    box: 'bg-accent-soft ring-accent-line',
    icon: 'text-accent',
    Icon: Info,
  },
  warning: {
    box: 'bg-warning-soft ring-warning-line',
    icon: 'text-warning',
    Icon: TriangleAlert,
  },
  danger: {
    box: 'bg-danger-soft ring-danger-line',
    icon: 'text-danger',
    Icon: CircleAlert,
  },
};

/**
 * Inline callout. `danger` uses `role="alert"`; the quieter tones use
 * `role="status"` (A11Y-024: assertive only for errors).
 */
export function Alert({
  tone = 'info',
  title,
  children,
  className,
}: {
  tone?: AlertTone;
  title?: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  const { box, icon, Icon } = TONES[tone];
  return (
    <div
      role={tone === 'danger' ? 'alert' : 'status'}
      className={cn(
        'flex gap-3 rounded-lg px-3.5 py-3 text-sm text-fg ring-1 ring-inset',
        box,
        className,
      )}
    >
      <Icon aria-hidden="true" className={cn('mt-0.5 size-4 shrink-0', icon)} />
      <div className="min-w-0 space-y-1 leading-relaxed [overflow-wrap:anywhere]">
        {title && <p className="font-medium">{title}</p>}
        {children && <div className="text-fg-muted">{children}</div>}
      </div>
    </div>
  );
}
