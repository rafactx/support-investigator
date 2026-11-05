import type { ReactNode } from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { buttonClasses } from './button.tsx';

/**
 * Right-side drawer on the same Radix Dialog primitive as `Dialog`. Enters
 * from the side its trigger lives on (ANIM-011, the header's right edge),
 * travels ~60% of its width with a drawer curve, and exits with a short
 * fade + blur instead of sliding fully away (ANIM-014). Full-width on
 * phones; height uses `dvh` (UI-020).
 */
export function Sheet({
  open,
  onOpenChange,
  title,
  description,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
}) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-overlay data-[state=closed]:animate-fade-out data-[state=open]:animate-fade-in" />
        <DialogPrimitive.Content
          className="fixed inset-y-0 right-0 z-50 flex h-dvh w-full max-w-2xl flex-col bg-surface shadow-raised focus-visible:outline-none data-[state=closed]:animate-drawer-out data-[state=open]:animate-drawer-in sm:inset-y-2 sm:right-2 sm:h-[calc(100dvh-1rem)] sm:w-[calc(100vw-1rem)] sm:rounded-2xl"
          {...(description ? {} : { 'aria-describedby': undefined })}
        >
          <div className="flex items-start justify-between gap-4 border-b border-line px-5 py-4 sm:px-6">
            <div className="min-w-0 space-y-1">
              <DialogPrimitive.Title className="text-base font-semibold tracking-tight">
                {title}
              </DialogPrimitive.Title>
              {description && (
                <DialogPrimitive.Description className="text-caption text-fg-muted">
                  {description}
                </DialogPrimitive.Description>
              )}
            </div>
            <DialogPrimitive.Close
              className={buttonClasses({
                variant: 'ghost',
                size: 'icon',
                className: '-mr-2 size-8',
              })}
              aria-label="Close panel"
            >
              <X aria-hidden="true" />
            </DialogPrimitive.Close>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
            {children}
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
