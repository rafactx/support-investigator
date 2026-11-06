import type { ReactElement } from 'react';
import {
  BookOpen,
  ChartLine,
  Cog,
  Globe,
  History,
  Layers,
  Monitor,
  Network,
  Plug,
  Search,
  Sparkles,
  Ticket,
} from 'lucide-react';

/**
 * Copy for the onboarding Drawer (ADR-0025). Every claim traces to a file or
 * ADR in this repo, except `ROADMAP_GROUPS`, which the Roadmap tab labels as
 * future work.
 */

export interface FlowStep {
  id: string;
  label: string;
  icon: ReactElement;
  summary: string;
  detail: string;
  reference: string;
}

/** Intake, confirmation, Fulfillment Playbook, Finding Policy, Investigation Decision. */
export const FLOW_STEPS: FlowStep[] = [
  {
    id: 'intake',
    label: 'Investigation Intake',
    icon: <Ticket aria-hidden="true" />,
    summary:
      'Structured fields, ticket text, or both — every value keeps its source.',
    detail:
      'Language Assistance may propose skuId/seller/quantity/destinationPostalCode from ticket text, but a proposed value stays unconfirmed until a human confirms it. Account Scope always comes from explicit trusted context, never from ticket text or a model proposal.',
    reference: 'buildIntake · ADR-0043/0044',
  },
  {
    id: 'playbook',
    label: 'Fulfillment Playbook',
    icon: <Search aria-hidden="true" />,
    summary:
      'A deterministic function calls 5 Operational Capabilities directly.',
    detail:
      'inventory, fulfillment simulation, warehouse-to-dock, dock-to-policy, and destination coverage — each a read-only, account-scoped call normalized into typed Ledger Facts. No model chooses which capability runs or in what order.',
    reference: 'fulfillment-playbook.ts · ADR-0039',
  },
  {
    id: 'ledger',
    label: 'Evidence Ledger',
    icon: <Layers aria-hidden="true" />,
    summary:
      'Typed, versioned, immutable facts — each traceable to its own capability call.',
    detail:
      'Facts are constructed from actual capability results and stay tied to the individual call that produced them. Missing, failed or contradictory evidence cannot be repaired by model prose.',
    reference: 'ADR-0031',
  },
  {
    id: 'policy',
    label: 'Finding Policy',
    icon: <Cog aria-hidden="true" />,
    summary:
      'A pure, deterministic function — not a model call — has final authority.',
    detail:
      'Each supported Finding Code has an Evidence Contract evaluated against the ledger as satisfied, insufficient, or contradicted. The model never assigns a Finding Code and never has the final word.',
    reference: 'finding-policy.ts',
  },
  {
    id: 'decision',
    label: 'Investigation Decision',
    icon: <Network aria-hidden="true" />,
    summary:
      'What the operator can do next — never a claim that a ticket was resolved.',
    detail:
      'ready_for_human_resolution when the contract is satisfied; needs_input when a required value is missing or unconfirmed; requires_specialist_review when a capability failed or evidence stayed insufficient/contradictory. A deterministic Finding Source Pack explanation is always included; a model-improved explanation is a separate, explicit operator request.',
    reference: 'ADR-0037/0038',
  },
];

export interface ArchitectureLayer {
  label: string;
  detail: string;
  icon: ReactElement;
}

export const ARCHITECTURE_LAYERS: ArchitectureLayer[] = [
  {
    label: 'React/Vite SPA',
    detail:
      'This screen. Talks to the Investigations API over POST/GET /investigations.',
    icon: <Monitor aria-hidden="true" />,
  },
  {
    label: 'Investigations API',
    detail:
      'Hono. The resource-oriented Investigation contract.',
    icon: <Globe aria-hidden="true" />,
  },
  {
    label: 'Fulfillment Playbook → Finding Policy',
    detail:
      'Deterministic TypeScript. The only thing that sets the Finding Code and Investigation Decision.',
    icon: <Cog aria-hidden="true" />,
  },
  {
    label: 'Language Assistance (AI SDK → Workers AI or Bedrock)',
    detail:
      'Bounded, degradable: proposes intake fields from ticket text, or improves a deterministic explanation on explicit request. Never authors a Ledger Fact or a Finding.',
    icon: <Sparkles aria-hidden="true" />,
  },
  {
    label: 'Support MCP',
    detail:
      'Streamable HTTP at /mcp (ADR-0007). An adapter that exposes the same 5 capabilities plus documentary search to any MCP client. The API never calls it (ADR-0039).',
    icon: <Plug aria-hidden="true" />,
  },
  {
    label: 'Knowledge Index',
    detail:
      'A committed index built by pnpm kb:refresh from the support articles in src/kb/articles. Documentary search only: it cannot produce a Ledger Fact or a Finding.',
    icon: <BookOpen aria-hidden="true" />,
  },
];

export interface RoadmapItem {
  title: string;
  detail: string;
}

export interface RoadmapGroup {
  category: string;
  tone: 'accent' | 'success' | 'warning';
  icon: ReactElement;
  items: RoadmapItem[];
}

/** Possible next steps, each tied to a seam or gap an ADR already names. */
export const ROADMAP_GROUPS: RoadmapGroup[] = [
  {
    category: 'Trust & auditability',
    tone: 'accent',
    icon: <Network aria-hidden="true" />,
    items: [
      {
        title: 'CX Intelligence Loop',
        detail:
          'Relating reviewed Findings to support patterns (recurrence, transfers, satisfaction) is the second planned slice (ADR-0027). It stays out of the decision path of any single investigation.',
      },
    ],
  },
  {
    category: 'Scale & operations',
    tone: 'success',
    icon: <ChartLine aria-hidden="true" />,
    items: [
      {
        title: 'Additional Symptom Codes',
        detail:
          'The Fulfillment Playbook covers one Symptom Code (STOCK_WITHOUT_DELIVERY_OPTIONS). Each new symptom needs its own capabilities and Evidence Contracts, so the playbook is not generalized before a second real case.',
      },
      {
        title: 'Streaming Investigation Progress',
        detail:
          'The API answers once the investigation finishes. Streaming progress over SSE would show each capability call as it happens instead of one loading state.',
      },
    ],
  },
  {
    category: 'Support team experience',
    tone: 'warning',
    icon: <History aria-hidden="true" />,
    items: [
      {
        title: 'Bulk ticket intake',
        detail:
          'The intake form handles one investigation at a time. A paste-many or CSV flow could run buildIntake per row.',
      },
    ],
  },
];
