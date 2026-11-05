import type { ReactNode } from 'react';
import * as TooltipPrimitive from '@radix-ui/react-tooltip';

export const TooltipProvider = TooltipPrimitive.Provider;

/**
 * Short hover/focus hint on Radix Tooltip. The trigger must already have
 * its own accessible name (A11Y-019); the tooltip only repeats it for
 * sighted pointer users. 150ms in (ANIM-001), growing from the trigger.
 */
export function Tooltip({
  label,
  children,
}: {
  label: ReactNode;
  children: ReactNode;
}) {
  return (
    <TooltipPrimitive.Root>
      <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Content
          sideOffset={6}
          collisionPadding={8}
          className="z-50 max-w-72 origin-(--radix-tooltip-content-transform-origin) rounded-md bg-inverse px-2 py-1 text-xs text-on-inverse shadow-raised data-[state=delayed-open]:animate-tooltip-in"
        >
          {label}
        </TooltipPrimitive.Content>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  );
}
