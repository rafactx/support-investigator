import { ROADMAP_GROUPS } from '../../lib/onboarding-content.tsx';
import { Badge } from '../ui/badge.tsx';

/**
 * Speculative evolutions, grouped by theme. Every item names the real seam
 * or gap it extends (see `onboarding-content.tsx`'s own doc comment) —
 * none of this is implemented, which the tab heading in
 * `OnboardingDrawer` states outright.
 */
export function RoadmapCards() {
  return (
    <div className="space-y-6">
      {ROADMAP_GROUPS.map((group) => (
        <section
          key={group.category}
          aria-label={group.category}
          className="space-y-2.5"
        >
          <Badge tone={group.tone}>
            {group.icon}
            {group.category}
          </Badge>
          <div className="grid gap-2.5 sm:grid-cols-2">
            {group.items.map((item) => (
              <article
                key={item.title}
                className="rounded-lg bg-surface p-4 shadow-card"
              >
                <h3 className="text-sm font-medium">{item.title}</h3>
                <p className="mt-1.5 text-caption leading-relaxed text-fg-muted">
                  {item.detail}
                </p>
              </article>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
