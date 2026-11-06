import type { ReactElement } from 'react';
import { CircleCheck, CircleDashed, CircleX } from 'lucide-react';
import type { InvestigationResponse } from '../lib/investigations-api-client.ts';
import { Badge, type BadgeTone } from './ui/badge.tsx';

type InvestigationDecisionValue = NonNullable<
  InvestigationResponse['decision']
>['outcome'];

interface DecisionMeta {
  label: string;
  tone: BadgeTone;
  icon: ReactElement;
}

/** Investigation Decision values (ADR-0037). Each tone has its own icon so color is not the only cue. */
const DECISION_META: Record<InvestigationDecisionValue, DecisionMeta> = {
  ready_for_human_resolution: {
    label: 'Ready for human resolution',
    tone: 'success',
    icon: <CircleCheck aria-hidden="true" />,
  },
  needs_input: {
    label: 'Needs input',
    tone: 'warning',
    icon: <CircleDashed aria-hidden="true" />,
  },
  requires_specialist_review: {
    label: 'Requires specialist review',
    tone: 'danger',
    icon: <CircleX aria-hidden="true" />,
  },
};

export function DecisionTag({
  decision,
}: {
  decision: InvestigationDecisionValue;
}) {
  const meta = DECISION_META[decision];
  return (
    <Badge tone={meta.tone} data-decision={decision}>
      {meta.icon}
      {meta.label}
    </Badge>
  );
}
