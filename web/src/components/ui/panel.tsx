import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from '../../lib/cn.ts';

/** The base surface: white (or raised dark) card with a layered hairline shadow (UI-005). */
export function Panel({ className, ...props }: HTMLAttributes<HTMLElement>) {
  return (
    <section
      className={cn('min-w-0 rounded-xl bg-surface shadow-card', className)}
      {...props}
    />
  );
}

export function PanelHeader({
  title,
  description,
  actions,
  className,
  titleId,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  className?: string;
  titleId?: string;
}) {
  return (
    <header
      className={cn(
        'flex flex-wrap items-start justify-between gap-3 px-5 pt-5 sm:px-6 sm:pt-6',
        className,
      )}
    >
      <div className="min-w-0 space-y-1">
        <h2
          id={titleId}
          className="text-base font-semibold tracking-tight text-fg"
        >
          {title}
        </h2>
        {description && (
          <p className="text-caption text-fg-muted">{description}</p>
        )}
      </div>
      {actions && (
        <div className="flex shrink-0 items-center gap-2">{actions}</div>
      )}
    </header>
  );
}

export function PanelBody({
  className,
  ...props
}: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn('px-5 pt-5 pb-5 sm:px-6 sm:pb-6', className)}
      {...props}
    />
  );
}

/** A labelled block inside a panel, separated from the previous one by a hairline. */
export function PanelSection({
  title,
  aside,
  children,
  className,
}: {
  title: ReactNode;
  aside?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('border-t border-line px-5 py-5 sm:px-6', className)}>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-xs font-medium tracking-wide text-fg-subtle uppercase">
          {title}
        </h3>
        {aside}
      </div>
      {children}
    </div>
  );
}
