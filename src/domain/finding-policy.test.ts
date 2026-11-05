import { describe, expect, it } from 'vitest';
import { createEvidenceLedger, evaluateFindingPolicy } from './finding-policy.ts';

const PROVENANCE = {
  investigationId: 'investigation-16',
  capabilityCallId: 'call-16',
  accountScope: { accountId: 'account-16' },
  observedAt: '2026-07-30T12:00:00.000Z',
  schemaVersion: '1',
} as const;

function ledgerWith(override?: Record<string, unknown>) {
  return createEvidenceLedger({
    facts: [
      {
        ...PROVENANCE,
        kind: 'inventory',
        capability: 'inventory',
        skuId: 'SKU-2002',
        seller: '1',
        requestedQuantity: 1,
        availableQuantity: 8,
      },
      {
        ...PROVENANCE,
        kind: 'symptom-reproduction',
        capability: 'fulfillment-simulation',
        symptomCode: 'STOCK_WITHOUT_DELIVERY_OPTIONS',
        skuId: 'SKU-2002',
        seller: '1',
        requestedQuantity: 1,
        destinationPostalCode: '01310-100',
        reproduced: true,
      },
      {
        ...PROVENANCE,
        kind: 'warehouse-to-dock',
        capability: 'warehouse-to-dock',
        warehouseId: 'WH-1',
        dockId: 'DOCK-1',
        routeAvailable: true,
      },
      {
        ...PROVENANCE,
        kind: 'dock-to-policy',
        capability: 'dock-to-policy',
        dockId: 'DOCK-1',
        policyId: 'POLICY-1',
        routeAvailable: true,
      },
      {
        ...PROVENANCE,
        kind: 'destination-coverage',
        capability: 'destination-coverage',
        policyId: 'POLICY-1',
        destinationPostalCode: '01310-100',
        covered: false,
      },
    ].map((fact) => (fact.kind === override?.kind ? { ...fact, ...override } : fact)),
  });
}

describe('Finding Policy for DESTINATION_NOT_COVERED', () => {
  it('assigns the positive finding only when every operational condition is satisfied', () => {
    const result = evaluateFindingPolicy(ledgerWith());

    expect(result).toMatchObject({
      findingCode: 'DESTINATION_NOT_COVERED',
      policyVersion: '1',
      contractResult: 'satisfied',
      decision: 'ready_for_human_resolution',
      decisionReason: 'contract_satisfied',
    });
  });

  it.each([
    ['inventory', { kind: 'inventory', availableQuantity: 0 }],
    ['symptom reproduction', { kind: 'symptom-reproduction', reproduced: false }],
    ['warehouse-to-dock', { kind: 'warehouse-to-dock', routeAvailable: false }],
    ['dock-to-policy', { kind: 'dock-to-policy', routeAvailable: false }],
    ['destination coverage', { kind: 'destination-coverage', covered: true }],
  ])('returns an undetermined finding for contradictory %s evidence', (_condition, override) => {
    const result = evaluateFindingPolicy(ledgerWith(override));

    expect(result).toMatchObject({
      findingCode: 'ROOT_CAUSE_UNDETERMINED',
      contractResult: 'contradicted',
      decision: 'requires_specialist_review',
      decisionReason: 'evidence_contradictory',
    });
  });

  it.each([
    ['inventory', 'inventory'],
    ['symptom reproduction', 'symptom-reproduction'],
    ['warehouse-to-dock', 'warehouse-to-dock'],
    ['dock-to-policy', 'dock-to-policy'],
    ['destination coverage', 'destination-coverage'],
  ])('returns an undetermined finding when %s evidence is missing', (_condition, missingKind) => {
    const complete = ledgerWith();
    const result = evaluateFindingPolicy(
      createEvidenceLedger({ facts: complete.facts.filter((fact) => fact.kind !== missingKind) })
    );

    expect(result).toMatchObject({
      findingCode: 'ROOT_CAUSE_UNDETERMINED',
      contractResult: 'insufficient',
      decision: 'requires_specialist_review',
      decisionReason: 'evidence_insufficient',
    });
  });

  it('fails closed for unsupported fact versions', () => {
    const complete = ledgerWith();
    const unsupported = {
      facts: complete.facts.map((fact) => ({ ...fact, schemaVersion: '999' })),
    };

    expect(evaluateFindingPolicy(unsupported)).toMatchObject({
      findingCode: 'ROOT_CAUSE_UNDETERMINED',
      contractResult: 'insufficient',
      decision: 'requires_specialist_review',
      decisionReason: 'unsupported_case',
    });
  });

  it('only creates immutable ledgers from strict operational fact schemas', () => {
    const complete = ledgerWith();

    expect(Object.isFrozen(complete)).toBe(true);
    expect(Object.isFrozen(complete.facts)).toBe(true);
    expect(() =>
      createEvidenceLedger({
        facts: [{ ...PROVENANCE, kind: 'inventory', capability: 'documentary-search', observation: 'Probably uncovered.' }],
      })
    ).toThrow();
    expect(() => createEvidenceLedger('model-authored prose')).toThrow();
    expect(
      evaluateFindingPolicy({
        facts: complete.facts.map((fact) => ({ ...fact })),
      })
    ).toMatchObject({ findingCode: 'ROOT_CAUSE_UNDETERMINED', decisionReason: 'unsupported_case' });
  });

  it.each([
    ['a warehouse-to-dock fact that points to another dock', 'warehouse-to-dock', { dockId: 'DOCK-2' }],
    ['a dock-to-policy fact that points to another policy', 'dock-to-policy', { policyId: 'POLICY-2' }],
    ['evidence from another investigation', 'inventory', { investigationId: 'investigation-other' }],
    ['evidence from another account scope', 'inventory', { accountScope: { accountId: 'account-other' } }],
    ['inventory for another seller', 'inventory', { seller: '2' }],
    ['inventory for another requested quantity', 'inventory', { requestedQuantity: 2 }],
    ['destination coverage for another postal code', 'destination-coverage', { destinationPostalCode: '01000-000' }],
  ])('rejects %s as contradictory evidence', (_description, kind, override) => {
    const complete = ledgerWith();
    const connected = createEvidenceLedger({
      facts: complete.facts.map((fact) => (fact.kind === kind ? { ...fact, ...override } : fact)),
    });

    expect(evaluateFindingPolicy(connected)).toMatchObject({
      findingCode: 'ROOT_CAUSE_UNDETERMINED',
      contractResult: 'contradicted',
      decisionReason: 'evidence_contradictory',
    });
  });
});
