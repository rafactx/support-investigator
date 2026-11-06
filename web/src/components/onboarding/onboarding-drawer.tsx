import type { ReactNode } from 'react';
import { ArrowUpRight, Rocket } from 'lucide-react';
import { ARCHITECTURE_LAYERS } from '../../lib/onboarding-content.tsx';
import { REPO_URL } from '../../lib/links.ts';
import { Code } from '../ui/code.tsx';
import { Sheet } from '../ui/sheet.tsx';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../ui/tabs.tsx';
import { FlowDiagram } from './flow-diagram.tsx';
import { RoadmapCards } from './roadmap-cards.tsx';

function Lede({ children }: { children: ReactNode }) {
  return <p className="max-w-[64ch] text-lede text-fg-muted">{children}</p>;
}

function Term({ children }: { children: ReactNode }) {
  return <span className="font-medium text-fg">{children}</span>;
}

const DECISIONS: readonly { code: string; text: string }[] = [
  {
    code: 'ready_for_human_resolution',
    text: 'The Evidence Contract for a Finding Code is satisfied.',
  },
  {
    code: 'needs_input',
    text: 'A required intake value is missing, ambiguous, or an unconfirmed model proposal.',
  },
  {
    code: 'requires_specialist_review',
    text: 'A capability failed, or the gathered evidence stayed insufficient or contradictory.',
  },
];

/**
 * "How it works" — the in-app explainer (`ADR-0025`). A side drawer, not a
 * centered dialog (full-viewport height for 5 tabs of dense content) and
 * not a new route (this SPA has no router, and the content is
 * documentation, not a distinct application state worth its own URL).
 * Auto-opens once per browser on first visit; `App.tsx` owns that decision
 * and the `localStorage` flag, the same split `DemoKeyModal` already uses
 * between "editing surface" (this component) and "when it opens" (the parent).
 */
export function OnboardingDrawer({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  return (
    <Sheet
      open={open}
      onOpenChange={(next) => !next && onClose()}
      title="How Support Investigator works"
      description="A read-only investigator for e-commerce fulfillment tickets."
    >
      <Tabs defaultValue="overview">
        <TabsList
          aria-label="Onboarding sections"
          className="sticky top-0 z-10 bg-surface"
        >
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="flow">Pipeline</TabsTrigger>
          <TabsTrigger value="decision">Decisions</TabsTrigger>
          <TabsTrigger value="architecture">Architecture</TabsTrigger>
          <TabsTrigger value="roadmap">Roadmap</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-6">
          <Lede>
            Support Investigator looks into one recurring fulfillment symptom on
            a commerce platform: a product shows stock, yet checkout offers no
            delivery option. A deterministic playbook gathers operational
            evidence, a pure policy assigns a Finding Code, and a human reviews
            the result. Nothing here changes or closes a support ticket.
          </Lede>
          <blockquote className="border-l-2 border-accent pl-4 text-sm font-medium text-fg">
            The Fulfillment Playbook decides deterministically. A model may only
            propose intake values for you to confirm, or rephrase an explanation
            when you ask.
          </blockquote>
          <ul className="grid gap-3 sm:grid-cols-3">
            {[
              {
                figure: '5',
                label:
                  'read-only Operational Capabilities. No write or mutating platform call is ever in scope.',
              },
              {
                figure: '0',
                label:
                  'platform credentials needed by default. A fixture gateway answers every call (ADR-0005).',
              },
              {
                figure: '1',
                label:
                  'Cloudflare Worker serves this app, the API and the MCP server, with D1 and Workers AI (ADR-0048).',
              },
            ].map((fact) => (
              <li
                key={fact.figure}
                className="rounded-lg bg-subtle p-4 ring-1 ring-line ring-inset"
              >
                <p className="font-mono text-xl font-medium tracking-tight tabular-nums">
                  {fact.figure}
                </p>
                <p className="mt-1 text-caption text-fg-muted">{fact.label}</p>
              </li>
            ))}
          </ul>
          <p className="text-caption text-fg-subtle">
            Built to study how far a deterministic policy can keep an LLM out of
            a support decision’s critical path. An independent portfolio
            project.
          </p>
        </TabsContent>

        <TabsContent value="flow" className="space-y-5">
          <Lede>
            Select a step to see what it does and why. Every claim traces to a
            specific file or decision record in the repository.
          </Lede>
          <FlowDiagram />
        </TabsContent>

        <TabsContent value="decision" className="space-y-5">
          <Lede>
            The <Term>Investigation Decision</Term> is the Finding Policy’s
            final, auditable disposition: what the operator can do next. It
            never claims a ticket was closed, and it is a different thing from{' '}
            <Term>Ticket Status</Term>, which this product never changes.
          </Lede>
          <dl className="divide-y divide-line rounded-lg ring-1 ring-line ring-inset">
            {DECISIONS.map((decision) => (
              <div key={decision.code} className="space-y-1 px-4 py-3">
                <dt>
                  <Code>{decision.code}</Code>
                </dt>
                <dd className="text-sm text-fg-muted">{decision.text}</dd>
              </div>
            ))}
          </dl>
          <Lede>
            Every completed investigation includes a deterministic Finding
            Source Pack explanation. You can separately request one
            model-improved explanation per investigation. It must stay grounded
            in the confirmed intake, the Evidence Ledger and the Finding, or the
            deterministic explanation is kept instead.
          </Lede>
        </TabsContent>

        <TabsContent value="architecture" className="space-y-5">
          <Lede>
            One investigation, top to bottom: from this screen to the Finding
            Policy.
          </Lede>
          <ol className="flex flex-col">
            {ARCHITECTURE_LAYERS.map((layer) => (
              <li
                key={layer.label}
                className="group relative flex gap-4 pb-5 last:pb-0"
              >
                <span
                  aria-hidden="true"
                  className="absolute top-9 bottom-0 left-[15px] w-px bg-line group-last:hidden"
                />
                <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-surface text-fg-muted shadow-card [&_svg]:size-4">
                  {layer.icon}
                </span>
                <div className="min-w-0 pt-1">
                  <p className="text-sm font-medium">{layer.label}</p>
                  <p className="mt-0.5 text-sm text-fg-muted">{layer.detail}</p>
                </div>
              </li>
            ))}
          </ol>
          <p className="text-caption text-fg-subtle">
            The full picture lives in the{' '}
            <a
              href={`${REPO_URL}#readme`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-0.5 text-accent underline decoration-accent/30 underline-offset-[3px] transition-[text-decoration-color] duration-200 hover:decoration-accent"
            >
              project README
              <ArrowUpRight aria-hidden="true" className="size-3" />
              <span className="sr-only">(opens in a new tab)</span>
            </a>{' '}
            and the decision records under <Code>docs/adr/</Code>.
          </p>
        </TabsContent>

        <TabsContent value="roadmap" className="space-y-5">
          <div className="flex items-center gap-2 text-sm font-medium">
            <Rocket aria-hidden="true" className="size-4 text-fg-subtle" />
            Speculative. None of this is built.
          </div>
          <Lede>
            Extensions the current architecture already supports, grouped by
            what each one addresses rather than by priority.
          </Lede>
          <RoadmapCards />
        </TabsContent>
      </Tabs>
    </Sheet>
  );
}
