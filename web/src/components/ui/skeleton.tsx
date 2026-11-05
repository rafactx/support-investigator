import { cn } from '../../lib/cn.ts';

/** Placeholder block with a slow linear shimmer; reduced-motion users get the static block. */
export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={cn(
        'rounded-md bg-[linear-gradient(90deg,var(--si-muted)_25%,var(--si-subtle)_50%,var(--si-muted)_75%)] bg-[length:200%_100%] motion-safe:animate-shimmer',
        className,
      )}
    />
  );
}
