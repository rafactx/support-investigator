import { type ButtonHTMLAttributes, forwardRef } from 'react';
import { cn } from '../../lib/cn.ts';
import { Spinner } from './spinner.tsx';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost';
export type ButtonSize = 'sm' | 'md' | 'lg' | 'icon';

const BASE =
  'relative inline-flex shrink-0 select-none items-center justify-center gap-1.5 whitespace-nowrap rounded-lg font-medium ' +
  'transition-[background-color,box-shadow,color,scale] duration-150 ease-out motion-safe:active:scale-[0.97] ' +
  'disabled:pointer-events-none disabled:opacity-50 aria-busy:pointer-events-none ' +
  '[&_svg]:size-4 [&_svg]:shrink-0';

const VARIANTS: Record<ButtonVariant, string> = {
  primary: 'bg-inverse text-on-inverse hover:bg-inverse-hover',
  secondary: 'bg-surface text-fg shadow-card hover:bg-subtle',
  ghost: 'text-fg-muted hover:bg-muted hover:text-fg',
};

// UI-013: 32px floor on desktop, 36–40px for primary actions.
const SIZES: Record<ButtonSize, string> = {
  sm: 'h-8 px-3 text-caption',
  md: 'h-9 px-3.5 text-sm',
  lg: 'h-10 px-4 text-sm',
  icon: 'size-9 text-sm',
};

export function buttonClasses({
  variant = 'secondary',
  size = 'md',
  className,
}: {
  variant?: ButtonVariant;
  size?: ButtonSize;
  className?: string;
} = {}): string {
  return cn(BASE, VARIANTS[variant], SIZES[size], className);
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Shows a spinner, sets `aria-busy`, and blocks further clicks without unmounting the label. */
  loading?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  function Button(
    {
      variant,
      size,
      loading = false,
      className,
      children,
      type = 'button',
      ...props
    },
    ref,
  ) {
    return (
      <button
        ref={ref}
        type={type}
        aria-busy={loading || undefined}
        className={buttonClasses({ variant, size, className })}
        {...props}
      >
        {loading && <Spinner />}
        {children}
      </button>
    );
  },
);
