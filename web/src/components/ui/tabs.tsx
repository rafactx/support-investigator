import type { ComponentPropsWithoutRef } from 'react';
import * as TabsPrimitive from '@radix-ui/react-tabs';
import { cn } from '../../lib/cn.ts';

/** Radix Tabs (roving focus, arrow keys, `aria-selected`) styled as an underline tab bar. */
export const Tabs = TabsPrimitive.Root;

export function TabsList({
  className,
  ...props
}: ComponentPropsWithoutRef<typeof TabsPrimitive.List>) {
  return (
    <TabsPrimitive.List
      className={cn(
        'flex gap-1 overflow-x-auto border-b border-line px-3 [scrollbar-width:none] sm:px-4',
        className,
      )}
      {...props}
    />
  );
}

export function TabsTrigger({
  className,
  children,
  ...props
}: ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger>) {
  return (
    <TabsPrimitive.Trigger
      className={cn(
        'group relative -mb-px flex h-11 rounded-md shrink-0 select-none items-center px-2.5 text-sm font-medium whitespace-nowrap text-fg-muted',
        'transition-colors duration-150 hover:text-fg focus-visible:-outline-offset-4 data-[state=active]:text-fg',
        className,
      )}
      {...props}
    >
      {/* UI-009: the indicator is its own layer, not a background swap. */}
      <span
        aria-hidden="true"
        className="absolute inset-x-2 bottom-0 h-0.5 rounded-full bg-fg opacity-0 transition-opacity duration-150 group-data-[state=active]:opacity-100"
      />
      {children}
    </TabsPrimitive.Trigger>
  );
}

export function TabsContent({
  className,
  ...props
}: ComponentPropsWithoutRef<typeof TabsPrimitive.Content>) {
  return (
    <TabsPrimitive.Content
      className={cn(
        'px-5 py-6 focus-visible:-outline-offset-2 sm:px-6',
        className,
      )}
      {...props}
    />
  );
}
