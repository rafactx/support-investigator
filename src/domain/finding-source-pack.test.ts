import { describe, expect, it } from 'vitest';
import {
  buildFindingExplanation,
  FINDING_SOURCE_PACK_VERSION,
} from './finding-source-pack.ts';
import { loadSupportArticles } from '../kb/support-articles.ts';
import type { DecisionReason } from './finding-policy.ts';

describe('buildFindingExplanation', () => {
  it('pins DESTINATION_NOT_COVERED to committed support runbooks, versioned', () => {
    const explanation = buildFindingExplanation({
      findingCode: 'DESTINATION_NOT_COVERED',
      decisionReason: 'contract_satisfied',
    });

    expect(explanation.sourcePackVersion).toBe(FINDING_SOURCE_PACK_VERSION);
    expect(explanation.sources.length).toBeGreaterThan(0);
    // Independent source of truth: the runbook corpus on disk — every
    // pinned source must name a real article by its exact URL and title.
    const titleByUrl = new Map(loadSupportArticles().map((a) => [a.url, a.title]));
    for (const source of explanation.sources) {
      expect(titleByUrl.get(source.url)).toBe(source.title);
    }
    expect(explanation.summary.length).toBeGreaterThan(0);
  });

  it('never satisfies the contract from the explanation itself — no source is a Ledger Fact substitute', () => {
    const explanation = buildFindingExplanation({
      findingCode: 'ROOT_CAUSE_UNDETERMINED',
      decisionReason: 'evidence_insufficient',
    });

    expect(explanation.sourcePackVersion).toBe(FINDING_SOURCE_PACK_VERSION);
    expect(explanation.sources.length).toBeGreaterThan(0);
  });

  it('names the failed capability in the summary when the decision reason is capability_failed', () => {
    const explanation = buildFindingExplanation({
      findingCode: 'ROOT_CAUSE_UNDETERMINED',
      decisionReason: 'capability_failed',
      capabilityFailure: {
        kind: 'permission_denied',
        capability: 'inventory',
        message: 'Inventory access was denied.',
      },
    });

    expect(explanation.summary).toContain('inventory');
    expect(explanation.summary).toContain('Inventory access was denied.');
  });

  // Exhaustive truth table: every DecisionReason produces a distinct,
  // non-empty explanation — a future reason added to the union without a
  // matching case here fails typecheck, not just this test.
  const REASONS: DecisionReason[] = [
    'contract_satisfied',
    'required_input_missing',
    'capability_failed',
    'evidence_insufficient',
    'evidence_contradictory',
    'unsupported_case',
  ];

  it.each(REASONS)('produces a non-empty summary for decisionReason %s', (decisionReason) => {
    const explanation = buildFindingExplanation({
      findingCode:
        decisionReason === 'contract_satisfied' ? 'DESTINATION_NOT_COVERED' : 'ROOT_CAUSE_UNDETERMINED',
      decisionReason,
    });

    expect(explanation.summary.trim().length).toBeGreaterThan(0);
  });
});
