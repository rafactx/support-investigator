import type { ReactNode } from 'react';
import { cn } from '../../lib/cn.ts';

/** WRITE-008: say what belongs here and, when there is one, offer a single next action. */
export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
}: {
  icon: ReactNode;
  title: ReactNode;
  description: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'flex flex-col items-center px-6 py-14 text-center',
        className,
      )}
    >
      <div className="mb-4 grid size-11 place-items-center rounded-xl bg-surface text-fg-muted shadow-card [&_svg]:size-5">
        {icon}
      </div>
      <h2 className="text-base font-semibold tracking-tight">{title}</h2>
      <p className="mt-1.5 max-w-sm text-sm text-fg-muted">{description}</p>
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}
