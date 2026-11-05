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
 * All copy for the onboarding Drawer (`ADR-0025`), pulled into one place so
 * the components stay presentational. Every claim here traces to a real
 * file or ADR in this repo — nothing is aspirational except `ROADMAP_GROUPS`,
 * which is explicitly labeled as such in the Roadmap tab itself.
 */

export interface FlowStep {
  id: string;
  label: string;
  icon: ReactElement;
  summary: string;
  detail: string;
  reference: string;
}

/**
 * The resource-oriented Fulfillment Investigation pipeline (the
 * cutover: intake → confirm → deterministic Playbook → Finding Policy →
 * Investigation Decision), replacing the retired `ticket → proposed → policy
 * gate → final` prototype flow.
 */
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
      'ready_for_human_resolution when the contract is satisfied; needs_input when a required value is missing or unconfirmed; requires_specialist_review when a capability failed or evidence stayed insufficient/contradictory. A deterministic Finding Source Pack explanation is always included; an improved, Bedrock-generated explanation is a separate, explicit operator request.',
    reference: 'ADR-0037/0038',
  },
];

export interface ArchitectureLayer {
  label: string;
  detail: string;
  icon: ReactElement;
}

/** README's own architecture summary, reworded for a scannable list instead of an ASCII diagram. */
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
      'Hono. The resource-oriented Investigation contract — the sole first-party investigation workflow.',
    icon: <Globe aria-hidden="true" />,
  },
  {
    label: 'Fulfillment Playbook → Finding Policy',
    detail:
      'Deterministic TypeScript, zero model authority — the only thing with final say over the Finding Code and Investigation Decision.',
    icon: <Cog aria-hidden="true" />,
  },
  {
    label: 'Language Assistance (AI SDK Core → Bedrock)',
    detail:
      'Bounded, degradable: proposes intake fields from ticket text, or improves a deterministic explanation on explicit request. Never authors a Ledger Fact or a Finding.',
    icon: <Sparkles aria-hidden="true" />,
  },
  {
    label: 'Support MCP',
    detail:
      'Lambda, Streamable HTTP (ADR-0007). An external adapter exposing the same 5 capabilities plus documentary search over the commerce-platform gateway — fixture by default, live behind an opt-in env var (ADR-0005) — not an internal hop the first-party runner takes.',
    icon: <Plug aria-hidden="true" />,
  },
  {
    label: 'Knowledge Index',
    detail:
      'Frozen, git-committed embeddings built once by pnpm kb:refresh from a curated set of commerce-platform docs. Optional documentary search only — no path to a Ledger Fact, a citation, or a Finding.',
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

/**
 * Speculative, out-of-the-box next steps — clearly labeled as such in the
 * Roadmap tab's own heading. Each one is anchored to a real seam or a gap
 * this project's own ADRs already name, not invented from nothing.
 */
export const ROADMAP_GROUPS: RoadmapGroup[] = [
  {
    category: 'Trust & auditability',
    tone: 'accent',
    icon: <Network aria-hidden="true" />,
    items: [
      {
        title: 'CX Intelligence Loop',
        detail:
          'Relating reviewed Findings to customer-support patterns (recurrence, transfers, satisfaction) is the required second product slice, deliberately out of the decision path of any individual investigation.',
      },
      {
        title: 'Durable, deployed persistence',
        detail:
          "The deployed stack still serves the in-memory repository today; migrating the API Lambda to DynamoDB-backed Investigations, with a stable resource URL surviving Lambda lifecycle changes, is the next step.",
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
          'The Fulfillment Playbook covers exactly one Symptom Code today (STOCK_WITHOUT_DELIVERY_OPTIONS). Each new symptom needs its own Operational Capabilities and Evidence Contracts, deliberately not generalized ahead of a second real case.',
      },
      {
        title: 'Streaming Investigation Progress',
        detail:
          'The SPA polls the finished resource today. A running investigation calling multiple capabilities could stream Investigation Progress over SSE, so the operator sees "checking inventory… simulating fulfillment…" live instead of one loading state.',
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
          'The intake form handles one investigation at a time. Support queues arrive in batches — a CSV/paste-many flow that runs buildIntake per row is a direct extension of the existing single-investigation seam.',
      },
      {
        title: 'Multi-language tickets',
        detail:
          'The Knowledge Index and Language Assistance extraction are English-only today. Merchants operate across Latin America, so ticket text arriving in Portuguese or Spanish is a realistic, near-term extension of the same intake seam.',
      },
    ],
  },
];
