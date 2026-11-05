import {
  forwardRef,
  type HTMLAttributes,
  type InputHTMLAttributes,
  type LabelHTMLAttributes,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '../../lib/cn.ts';

export function Field({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn('flex min-w-0 flex-col gap-1.5', className)}
      {...props}
    />
  );
}

export function Label({
  className,
  htmlFor,
  children,
  ...props
}: LabelHTMLAttributes<HTMLLabelElement> & { htmlFor: string }) {
  return (
    <label
      htmlFor={htmlFor}
      className={cn('text-caption font-medium text-fg', className)}
      {...props}
    >
      {children}
    </label>
  );
}

/** Secondary hint under a field. Callers wire it to the control with `aria-describedby`. */
export function FieldDescription({
  className,
  ...props
}: HTMLAttributes<HTMLParagraphElement>) {
  return (
    <p className={cn('text-caption text-fg-subtle', className)} {...props} />
  );
}

/** Marks a label as optional in a quieter weight than the label itself. */
export function Optional() {
  return <span className="font-normal text-fg-subtle"> (optional)</span>;
}

// TYPE-042: 16px text on phones so iOS never zooms on focus; 14px from `sm`.
const CONTROL =
  'w-full min-w-0 rounded-lg bg-surface text-base text-fg shadow-card sm:text-sm ' +
  'placeholder:text-fg-subtle transition-[box-shadow] duration-150 ease-out ' +
  'hover:shadow-[0_0_0_1px_var(--si-line-strong)] ' +
  'focus-visible:outline-none focus-visible:shadow-[0_0_0_1px_var(--si-accent),0_0_0_4px_var(--si-accent-soft)] ' +
  'disabled:cursor-not-allowed disabled:bg-subtle disabled:text-fg-muted ' +
  'aria-invalid:shadow-[0_0_0_1px_var(--si-danger)]';

export const Input = forwardRef<
  HTMLInputElement,
  InputHTMLAttributes<HTMLInputElement>
>(function Input({ className, ...props }, ref) {
  return (
    <input
      ref={ref}
      className={cn(CONTROL, 'h-9 px-3', className)}
      {...props}
    />
  );
});

export const Textarea = forwardRef<
  HTMLTextAreaElement,
  TextareaHTMLAttributes<HTMLTextAreaElement>
>(function Textarea({ className, ...props }, ref) {
  return (
    <textarea
      ref={ref}
      className={cn(
        CONTROL,
        'min-h-20 resize-y px-3 py-2 leading-relaxed',
        className,
      )}
      {...props}
    />
  );
});

/** A native `<select>` (A11Y-002 allows it; the platform picker is the accessible one) styled like the inputs. */
export const Select = forwardRef<
  HTMLSelectElement,
  SelectHTMLAttributes<HTMLSelectElement>
>(function Select({ className, children, ...props }, ref) {
  return (
    <div className="relative">
      <select
        ref={ref}
        className={cn(CONTROL, 'h-9 appearance-none pr-9 pl-3', className)}
        {...props}
      >
        {children}
      </select>
      <ChevronDown
        aria-hidden="true"
        className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-fg-subtle"
      />
    </div>
  );
});
