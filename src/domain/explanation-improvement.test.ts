import { describe, expect, it } from 'vitest';
import {
  buildAllowedPlaceholders,
  buildExplanationImprovementRequest,
  checkExplanationGrounding,
} from './explanation-improvement.ts';
import { findingSourcePack } from './finding-source-pack.ts';
import type { LedgerFact } from './finding-policy.ts';
import type { ConfirmedFulfillmentIntake } from './fulfillment-playbook.ts';

const INTAKE: ConfirmedFulfillmentIntake = {
  investigationId: 'inv-1',
  accountScope: { accountId: 'account-17' },
  skuId: 'SKU-2002',
  seller: '1',
  quantity: 3,
  destinationPostalCode: '01310-100',
};

const ENVELOPE = {
  investigationId: 'inv-1',
  capabilityCallId: 'call-1',
  accountScope: { accountId: 'account-17' },
  observedAt: '2026-07-30T12:00:00.000Z',
  schemaVersion: '1' as const,
};

const LEDGER_FACTS: readonly LedgerFact[] = [
  {
    ...ENVELOPE,
    kind: 'warehouse-to-dock',
    capability: 'warehouse-to-dock',
    warehouseId: 'WH-1',
    dockId: 'DOCK-1',
    routeAvailable: true,
  },
  {
    ...ENVELOPE,
    kind: 'dock-to-policy',
    capability: 'dock-to-policy',
    dockId: 'DOCK-1',
    policyId: 'POL-1',
    routeAvailable: true,
  },
];

const PINNED_URLS = findingSourcePack('DESTINATION_NOT_COVERED').map((source) => source.url);

describe('buildAllowedPlaceholders', () => {
  it('always includes the confirmed intake fields, keyed by name', () => {
    const placeholders = buildAllowedPlaceholders({ intake: INTAKE, ledgerFacts: [] });
    expect(placeholders).toEqual({
      skuId: 'SKU-2002',
      seller: '1',
      quantity: '3',
      destinationPostalCode: '01310-100',
    });
  });

  it('adds identifiers only the Evidence Ledger actually produced', () => {
    const placeholders = buildAllowedPlaceholders({ intake: INTAKE, ledgerFacts: LEDGER_FACTS });
    expect(placeholders.warehouseId).toBe('WH-1');
    expect(placeholders.dockId).toBe('DOCK-1');
    expect(placeholders.policyId).toBe('POL-1');
  });

  it('adds capability-failure identifiers when present', () => {
    const placeholders = buildAllowedPlaceholders({
      intake: INTAKE,
      ledgerFacts: [],
      capabilityFailure: { kind: 'permission_denied', capability: 'inventory', message: 'Inventory access was denied.' },
    });
    expect(placeholders.capabilityName).toBe('inventory');
    expect(placeholders.capabilityFailureMessage).toBe('Inventory access was denied.');
  });
});

describe('buildExplanationImprovementRequest', () => {
  const placeholders = buildAllowedPlaceholders({ intake: INTAKE, ledgerFacts: LEDGER_FACTS });

  it('sends only placeholder names to the model, never their values', () => {
    const request = buildExplanationImprovementRequest({
      findingCode: 'DESTINATION_NOT_COVERED',
      decision: 'ready_for_human_resolution',
      decisionReason: 'contract_satisfied',
      deterministicSummary: 'Deterministic summary text.',
      placeholders,
    });

    expect(request.allowedPlaceholderNames).toEqual(
      expect.arrayContaining(['skuId', 'seller', 'quantity', 'destinationPostalCode', 'warehouseId', 'dockId', 'policyId']),
    );
    expect(JSON.stringify(request)).not.toContain('SKU-2002');
    expect(JSON.stringify(request)).not.toContain('01310-100');
    expect(request.sourcePackUrls).toEqual(PINNED_URLS);
  });

  it('rebuilds the deterministic summary from placeholders when a capability failure is present, never the raw provider message (ADR-0045)', () => {
    const failurePlaceholders = buildAllowedPlaceholders({
      intake: INTAKE,
      ledgerFacts: [],
      capabilityFailure: {
        kind: 'schema_failure',
        capability: 'inventory',
        message: 'Inventory returned an unsupported response after 30 seconds.',
      },
    });

    const request = buildExplanationImprovementRequest({
      findingCode: 'ROOT_CAUSE_UNDETERMINED',
      decision: 'requires_specialist_review',
      decisionReason: 'capability_failed',
      deterministicSummary: 'The inventory check could not be completed (Inventory returned an unsupported response after 30 seconds).',
      placeholders: failurePlaceholders,
      capabilityFailure: {
        kind: 'schema_failure',
        capability: 'inventory',
        message: 'Inventory returned an unsupported response after 30 seconds.',
      },
    });

    expect(request.deterministicSummary).not.toContain('Inventory returned an unsupported response');
    expect(request.deterministicSummary).not.toMatch(/\d/);
    expect(request.deterministicSummary).toContain('{{capabilityName}}');
    expect(request.deterministicSummary).toContain('{{capabilityFailureMessage}}');
  });
});

describe('checkExplanationGrounding', () => {
  const allowedPlaceholders = buildAllowedPlaceholders({ intake: INTAKE, ledgerFacts: LEDGER_FACTS });
  const allowed = { findingCode: 'DESTINATION_NOT_COVERED' as const, placeholders: allowedPlaceholders };

  it('accepts a proposal that only uses allowed placeholders and pinned citations, substituting real values', () => {
    const result = checkExplanationGrounding(
      {
        summaryTemplate: 'SKU {{skuId}} for seller {{seller}} has no coverage to {{destinationPostalCode}}.',
        citedSourceUrls: [PINNED_URLS[0] as string],
      },
      allowed,
      '2026-07-31T00:00:00.000Z',
    );

    expect(result.kind).toBe('grounded');
    if (result.kind === 'grounded') {
      expect(result.explanation.summary).toBe('SKU SKU-2002 for seller 1 has no coverage to 01310-100.');
      expect(result.explanation.generatedAt).toBe('2026-07-31T00:00:00.000Z');
      expect(result.explanation.sources).toHaveLength(1);
    }
  });

  it('rejects a proposal with no citations', () => {
    const result = checkExplanationGrounding({ summaryTemplate: 'No citation here.', citedSourceUrls: [] }, allowed, 'now');
    expect(result.kind).toBe('ungrounded');
  });

  it('rejects a citation outside the pinned Source Pack', () => {
    const result = checkExplanationGrounding(
      { summaryTemplate: 'Fine wording.', citedSourceUrls: ['https://example.invalid/not-pinned'] },
      allowed,
      'now',
    );
    expect(result.kind).toBe('ungrounded');
    if (result.kind === 'ungrounded') {
      expect(result.reason).toContain('example.invalid');
    }
  });

  it('rejects a placeholder name outside the allowlist (a fabricated identifier reference)', () => {
    const result = checkExplanationGrounding(
      { summaryTemplate: 'The SKU is {{fabricatedSkuId}}.', citedSourceUrls: [PINNED_URLS[0] as string] },
      allowed,
      'now',
    );
    expect(result.kind).toBe('ungrounded');
    if (result.kind === 'ungrounded') {
      expect(result.reason).toContain('fabricatedSkuId');
    }
  });

  it('rejects a raw digit written outside any placeholder, even one that happens to match a real value', () => {
    const result = checkExplanationGrounding(
      { summaryTemplate: 'SKU SKU-2002 has no coverage.', citedSourceUrls: [PINNED_URLS[0] as string] },
      allowed,
      'now',
    );
    expect(result.kind).toBe('ungrounded');
  });
});
