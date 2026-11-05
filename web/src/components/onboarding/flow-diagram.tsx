import { useState } from 'react';
import { FLOW_STEPS } from '../../lib/onboarding-content.tsx';
import { cn } from '../../lib/cn.ts';
import { Code } from '../ui/code.tsx';

/**
 * The `intake → playbook → ledger → policy → decision` pipeline as
 * selectable steps, expanding one detail panel at a time. Real
 * `<button>`s with `aria-pressed` (A11Y-004) for native keyboard/focus
 * semantics; the detail panel is a polite live region so a screen reader
 * hears the newly selected step.
 */
export function FlowDiagram() {
  const [activeId, setActiveId] = useState(FLOW_STEPS[0].id);
  const active =
    FLOW_STEPS.find((step) => step.id === activeId) ?? FLOW_STEPS[0];

  return (
    <div className="space-y-4">
      <ol className="grid grid-cols-1 gap-2 sm:grid-cols-5">
        {FLOW_STEPS.map((step, index) => {
          const isActive = step.id === activeId;
          return (
            <li key={step.id} className="min-w-0">
              <button
                type="button"
                onClick={() => setActiveId(step.id)}
                aria-pressed={isActive}
                className={cn(
                  'flex h-full w-full select-none items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-[box-shadow,background-color] duration-150 sm:flex-col sm:items-start sm:gap-2',
                  isActive
                    ? 'bg-surface shadow-[0_0_0_1.5px_var(--si-fg)]'
                    : 'bg-surface shadow-card hover:bg-subtle',
                )}
              >
                <span className="flex items-center gap-2">
                  <span
                    className={cn(
                      'grid size-5 place-items-center rounded-full font-mono text-2xs tabular-nums',
                      isActive
                        ? 'bg-inverse text-on-inverse'
                        : 'bg-muted text-fg-muted',
                    )}
                    aria-hidden="true"
                  >
                    {index + 1}
                  </span>
                  <span
                    className={cn(
                      '[&_svg]:size-4',
                      isActive ? 'text-fg' : 'text-fg-subtle',
                    )}
                  >
                    {step.icon}
                  </span>
                </span>
                <span className="text-caption leading-snug font-medium">
                  {step.label}
                </span>
              </button>
            </li>
          );
        })}
      </ol>

      <section
        aria-live="polite"
        className="rounded-lg bg-subtle p-4 ring-1 ring-line ring-inset sm:p-5"
      >
        <p className="text-sm font-medium">{active.summary}</p>
        <p className="mt-2 text-sm leading-relaxed text-fg-muted">
          {active.detail}
        </p>
        <p className="mt-3">
          <Code className="text-fg-muted">{active.reference}</Code>
        </p>
      </section>
    </div>
  );
}
