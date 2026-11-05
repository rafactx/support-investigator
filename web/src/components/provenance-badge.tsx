import { Sparkles, UserRound } from 'lucide-react';
import { Badge } from './ui/badge.tsx';

/**
 * One intake value's provenance ("the UI exposes model
 * provenance"). A model proposal reads in the warning tone with a sparkle
 * until a human confirms it; operator-entered values stay neutral. The
 * icon and text carry the meaning, not the colour (A11Y-028).
 */
export function ProvenanceBadge({
  source,
  confirmed,
}: {
  source: 'user' | 'model';
  confirmed: boolean;
}) {
  const isModel = source === 'model';
  return (
    <Badge
      tone={isModel && !confirmed ? 'warning' : isModel ? 'accent' : 'neutral'}
    >
      {isModel ? (
        <Sparkles aria-hidden="true" />
      ) : (
        <UserRound aria-hidden="true" />
      )}
      {isModel ? 'Model proposal' : 'Operator'}
      <span aria-hidden="true" className="opacity-50">
        ·
      </span>
      {confirmed ? 'confirmed' : 'unconfirmed'}
    </Badge>
  );
}
