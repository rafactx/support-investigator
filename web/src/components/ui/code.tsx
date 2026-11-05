import type { HTMLAttributes } from 'react';
import { cn } from '../../lib/cn.ts';

/** Inline technical token (field names, codes, ids): mono on a muted chip, allowed to break (TYPE-027). */
export function Code({ className, ...props }: HTMLAttributes<HTMLElement>) {
  return (
    <code
      className={cn(
        'rounded-[5px] bg-muted px-1.5 py-px font-mono text-[0.8125em] text-fg tabular-nums [overflow-wrap:anywhere]',
        className,
      )}
      {...props}
    />
  );
}
