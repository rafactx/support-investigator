import { describe, expect, it } from 'vitest';
import {
  buildInvestigationOutcome,
  confirmedUserIntake,
  evaluateIntakeReadiness,
  foldInvestigationEvents,
  modelProposed,
  type FulfillmentIntake,
  type InvestigationEvent,
} from './investigation.ts';
import { createEvidenceLedger, type LedgerFact } from './finding-policy.ts';
import type { FulfillmentPlaybookResult } from './fulfillment-playbook.ts';

const ENVELOPE = {
  investigationId: 'inv-1',
  capabilityCallId: 'call-1',
  accountScope: { accountId: 'account-17' },
  observedAt: '2026-07-30T12:00:00.000Z',
  schemaVersion: '1' as const,
};

function satisfiedFacts(): LedgerFact[] {
  return [
    {
      ...ENVELOPE,
      kind: 'inventory',
      capability: 'inventory',
      skuId: 'SKU-2002',
      seller: '1',
      requestedQuantity: 1,
      availableQuantity: 8,
    },
    {
      ...ENVELOPE,
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
      policyId: 'POLICY-1',
      routeAvailable: true,
    },
    {
      ...ENVELOPE,
      kind: 'destination-coverage',
      capability: 'destination-coverage',
      policyId: 'POLICY-1',
      destinationPostalCode: '01310-100',
      covered: false,
    },
  ];
}

describe('confirmedUserIntake', () => {
  it('marks every field source: user, confirmed: true (AC1: only confirmed structured values)', () => {
    const intake = confirmedUserIntake({
      accountId: 'account-17',
      skuId: 'SKU-2002',
      seller: '1',
      quantity: 1,
      destinationPostalCode: '01310-100',
    });

    expect(intake.symptomCode).toBe('STOCK_WITHOUT_DELIVERY_OPTIONS');
    for (const field of [intake.accountScope, intake.skuId, intake.seller, intake.quantity, intake.destinationPostalCode]) {
      expect(field).toBeDefined();
      expect(field?.source).toBe('user');
      expect(field?.confirmed).toBe(true);
    }
    expect(intake.accountScope?.value).toEqual({ accountId: 'account-17' });
    expect(intake.skuId?.value).toBe('SKU-2002');
  });
});

describe('evaluateIntakeReadiness', () => {
  const READY_INTAKE = confirmedUserIntake({
    accountId: 'account-17',
    skuId: 'SKU-2002',
    seller: '1',
    quantity: 1,
    destinationPostalCode: '01310-100',
  });

  it('is ready when every required field is present and confirmed', () => {
    const readiness = evaluateIntakeReadiness('inv-1', READY_INTAKE);
    expect(readiness).toEqual({
      kind: 'ready',
      confirmed: {
        investigationId: 'inv-1',
        accountScope: { accountId: 'account-17' },
        skuId: 'SKU-2002',
        seller: '1',
        quantity: 1,
        destinationPostalCode: '01310-100',
      },
    });
  });

  it('reports a missing gap when a required field is entirely absent (AC3)', () => {
    const intake: FulfillmentIntake = { ...READY_INTAKE, seller: undefined };
    const readiness = evaluateIntakeReadiness('inv-1', intake);
    expect(readiness).toEqual({ kind: 'awaiting_input', gaps: [{ field: 'seller', reason: 'missing' }] });
  });

  it('reports an unconfirmed gap for a model-proposed field N2 has not confirmed (AC4)', () => {
    const intake: FulfillmentIntake = { ...READY_INTAKE, skuId: modelProposed('SKU-2002') };
    const readiness = evaluateIntakeReadiness('inv-1', intake);
    expect(readiness).toEqual({ kind: 'awaiting_input', gaps: [{ field: 'skuId', reason: 'unconfirmed' }] });
  });

  it('reports every gap, not just the first, across missing and unconfirmed fields', () => {
    const intake: FulfillmentIntake = {
      ...READY_INTAKE,
      accountScope: undefined,
      quantity: modelProposed(1),
    };
    const readiness = evaluateIntakeReadiness('inv-1', intake);
    expect(readiness).toEqual({
      kind: 'awaiting_input',
      gaps: [
        { field: 'accountScope', reason: 'missing' },
        { field: 'quantity', reason: 'unconfirmed' },
      ],
    });
  });

  it('a user-confirmed correction of a previously model-proposed field clears its gap', () => {
    const intake: FulfillmentIntake = {
      ...READY_INTAKE,
      destinationPostalCode: { value: '01310-100', source: 'user', confirmed: true },
    };
    expect(evaluateIntakeReadiness('inv-1', intake).kind).toBe('ready');
  });
});

describe('buildInvestigationOutcome', () => {
  it('maps an observed, contract-satisfied playbook result to DESTINATION_NOT_COVERED', () => {
    const playbookResult: FulfillmentPlaybookResult = {
      kind: 'observed',
      ledger: createEvidenceLedger({ facts: satisfiedFacts() }),
      symptomReproduced: true,
    };

    const outcome = buildInvestigationOutcome(playbookResult);

    expect(outcome.findingCode).toBe('DESTINATION_NOT_COVERED');
    expect(outcome.contractResult).toBe('satisfied');
    expect(outcome.decision).toBe('ready_for_human_resolution');
    expect(outcome.decisionReason).toBe('contract_satisfied');
    expect(outcome.ledgerFacts).toHaveLength(5);
    expect(outcome.capabilityFailure).toBeUndefined();
    expect(outcome.explanation.sources.length).toBeGreaterThan(0);
  });

  it('maps a capability failure to requires_specialist_review without inventing a ledger (ADR-0037)', () => {
    const playbookResult: FulfillmentPlaybookResult = {
      kind: 'insufficient-evidence',
      failure: {
        kind: 'permission_denied',
        capability: 'inventory',
        message: 'Inventory access was denied.',
      },
    };

    const outcome = buildInvestigationOutcome(playbookResult);

    expect(outcome.findingCode).toBe('ROOT_CAUSE_UNDETERMINED');
    expect(outcome.contractResult).toBe('insufficient');
    expect(outcome.decision).toBe('requires_specialist_review');
    expect(outcome.decisionReason).toBe('capability_failed');
    expect(outcome.ledgerFacts).toHaveLength(0);
    expect(outcome.capabilityFailure).toEqual({
      kind: 'permission_denied',
      capability: 'inventory',
      message: 'Inventory access was denied.',
    });
  });
});

describe('foldInvestigationEvents', () => {
  it('returns undefined for an empty history (nothing to project)', () => {
    expect(foldInvestigationEvents([])).toBeUndefined();
  });

  it('reconstructs the Current Investigation projection from a hand-built event array (ADR-0034 AC4)', () => {
    const intake = confirmedUserIntake({
      accountId: 'account-17',
      skuId: 'SKU-2002',
      seller: '1',
      quantity: 1,
      destinationPostalCode: '01310-100',
    });
    const outcome = buildInvestigationOutcome({
      kind: 'observed',
      ledger: createEvidenceLedger({ facts: satisfiedFacts() }),
      symptomReproduced: true,
    });
    const events: InvestigationEvent[] = [
      {
        kind: 'investigation_created',
        investigationId: 'inv-1',
        occurredAt: '2026-07-30T12:00:00.000Z',
        intake,
        state: 'completed',
        outcome,
      },
    ];

    const projection = foldInvestigationEvents(events);

    expect(projection).toEqual({
      id: 'inv-1',
      state: 'completed',
      revision: 1,
      createdAt: '2026-07-30T12:00:00.000Z',
      intake,
      outcome,
      failureReason: undefined,
      reviews: [],
    });
  });

  it('revision tracks the number of applied events, not a field any one event carries', () => {
    const intake = confirmedUserIntake({
      accountId: 'account-17',
      skuId: 'SKU-2002',
      seller: '1',
      quantity: 1,
      destinationPostalCode: '01310-100',
    });
    const created: InvestigationEvent = {
      kind: 'investigation_created',
      investigationId: 'inv-1',
      occurredAt: '2026-07-30T12:00:00.000Z',
      intake,
      state: 'failed',
      failureReason: 'unexpected_error',
    };

    expect(foldInvestigationEvents([created])?.revision).toBe(1);
    // A second identical event replayed (e.g. a duplicate delivery) still
    // folds to a single coherent projection instead of throwing — revision
    // reflects history length, which is deliberately visible here so a
    // future event kind can be added without this test silently going stale.
    expect(foldInvestigationEvents([created, created])?.revision).toBe(2);
  });

  it('a later intake_updated event overwrites intake, state and outcome, not just revision', () => {
    const awaitingIntake = confirmedUserIntake({
      accountId: 'account-17',
      skuId: 'SKU-2002',
      seller: '1',
      quantity: 1,
      destinationPostalCode: '01310-100',
    });
    const created: InvestigationEvent = {
      kind: 'investigation_created',
      investigationId: 'inv-1',
      occurredAt: '2026-07-30T12:00:00.000Z',
      intake: { ...awaitingIntake, seller: undefined },
      state: 'awaiting_input',
    };

    const resumedOutcome = buildInvestigationOutcome({
      kind: 'observed',
      ledger: createEvidenceLedger({ facts: satisfiedFacts() }),
      symptomReproduced: true,
    });
    const updated: InvestigationEvent = {
      kind: 'intake_updated',
      investigationId: 'inv-1',
      occurredAt: '2026-07-30T12:05:00.000Z',
      intake: awaitingIntake,
      state: 'completed',
      outcome: resumedOutcome,
    };

    const beforeUpdate = foldInvestigationEvents([created]);
    expect(beforeUpdate?.state).toBe('awaiting_input');
    expect(beforeUpdate?.outcome).toBeUndefined();
    expect(beforeUpdate?.revision).toBe(1);

    const afterUpdate = foldInvestigationEvents([created, updated]);
    expect(afterUpdate).toEqual({
      id: 'inv-1',
      state: 'completed',
      revision: 2,
      createdAt: '2026-07-30T12:00:00.000Z',
      intake: awaitingIntake,
      outcome: resumedOutcome,
      failureReason: undefined,
      reviews: [],
    });
  });

  it('an intake_updated event with no preceding investigation_created is a no-op (defends against corrupt/partial history)', () => {
    const orphan: InvestigationEvent = {
      kind: 'intake_updated',
      investigationId: 'inv-1',
      occurredAt: '2026-07-30T12:00:00.000Z',
      intake: confirmedUserIntake({
        accountId: 'account-17',
        skuId: 'SKU-2002',
        seller: '1',
        quantity: 1,
        destinationPostalCode: '01310-100',
      }),
      state: 'completed',
    };
    expect(foldInvestigationEvents([orphan])).toBeUndefined();
  });

  describe('explanation_improvement_requested', () => {
    function completedEvents(): InvestigationEvent[] {
      const intake = confirmedUserIntake({
        accountId: 'account-17',
        skuId: 'SKU-2002',
        seller: '1',
        quantity: 1,
        destinationPostalCode: '01310-100',
      });
      const outcome = buildInvestigationOutcome({
        kind: 'observed',
        ledger: createEvidenceLedger({ facts: satisfiedFacts() }),
        symptomReproduced: true,
      });
      return [
        {
          kind: 'investigation_created',
          investigationId: 'inv-1',
          occurredAt: '2026-07-30T12:00:00.000Z',
          intake,
          state: 'completed',
          outcome,
        },
      ];
    }

    it('an accepted result attaches improvedExplanation to outcome, leaving every other outcome field untouched', () => {
      const created = completedEvents();
      const improved: InvestigationEvent = {
        kind: 'explanation_improvement_requested',
        investigationId: 'inv-1',
        occurredAt: '2026-07-30T12:05:00.000Z',
        result: {
          status: 'accepted',
          improvedExplanation: {
            summary: 'Improved wording.',
            sourcePackVersion: '1',
            sources: [],
            generatedAt: '2026-07-30T12:05:00.000Z',
          },
        },
      };

      const before = foldInvestigationEvents(created);
      const after = foldInvestigationEvents([...created, improved]);

      expect(after?.revision).toBe(2);
      expect(after?.outcome?.explanationImprovement).toEqual(improved.result);
      // Everything else about the outcome is byte-identical to before the event.
      expect({ ...after?.outcome, explanationImprovement: undefined }).toEqual({
        ...before?.outcome,
        explanationImprovement: undefined,
      });
    });

    it('a rejected result attaches its reason without inventing an improvedExplanation', () => {
      const created = completedEvents();
      const rejected: InvestigationEvent = {
        kind: 'explanation_improvement_requested',
        investigationId: 'inv-1',
        occurredAt: '2026-07-30T12:05:00.000Z',
        result: { status: 'rejected', reason: 'Cited an off-pack URL.' },
      };

      const after = foldInvestigationEvents([...created, rejected]);

      expect(after?.outcome?.explanationImprovement).toEqual({ status: 'rejected', reason: 'Cited an off-pack URL.' });
    });

    it('is a no-op when no outcome exists yet (an awaiting_input Investigation has nothing to attach an improvement to)', () => {
      const events: InvestigationEvent[] = [
        {
          kind: 'investigation_created',
          investigationId: 'inv-1',
          occurredAt: '2026-07-30T12:00:00.000Z',
          intake: confirmedUserIntake({
            accountId: 'account-17',
            skuId: 'SKU-2002',
            seller: '1',
            quantity: 1,
            destinationPostalCode: '01310-100',
          }),
          state: 'awaiting_input',
        },
        {
          kind: 'explanation_improvement_requested',
          investigationId: 'inv-1',
          occurredAt: '2026-07-30T12:05:00.000Z',
          result: { status: 'rejected', reason: 'unreachable in practice' },
        },
      ];

      const projection = foldInvestigationEvents(events);
      expect(projection?.state).toBe('awaiting_input');
      expect(projection?.outcome).toBeUndefined();
      // The event still counts toward revision even though it had nothing to attach to.
      expect(projection?.revision).toBe(2);
    });

    it('a later intake_updated event drops a previously accepted explanationImprovement (it belonged to the outcome that was replaced)', () => {
      const created = completedEvents();
      const improved: InvestigationEvent = {
        kind: 'explanation_improvement_requested',
        investigationId: 'inv-1',
        occurredAt: '2026-07-30T12:05:00.000Z',
        result: {
          status: 'accepted',
          improvedExplanation: {
            summary: 'Improved wording.',
            sourcePackVersion: '1',
            sources: [],
            generatedAt: '2026-07-30T12:05:00.000Z',
          },
        },
      };
      const newOutcome = buildInvestigationOutcome({
        kind: 'observed',
        ledger: createEvidenceLedger({ facts: satisfiedFacts() }),
        symptomReproduced: true,
      });
      const recomputed: InvestigationEvent = {
        kind: 'intake_updated',
        investigationId: 'inv-1',
        occurredAt: '2026-07-30T12:10:00.000Z',
        intake: confirmedUserIntake({
          accountId: 'account-17',
          skuId: 'SKU-2002',
          seller: '2',
          quantity: 1,
          destinationPostalCode: '01310-100',
        }),
        state: 'completed',
        outcome: newOutcome,
      };

      const projection = foldInvestigationEvents([...created, improved, recomputed]);

      expect(projection?.outcome?.explanationImprovement).toBeUndefined();
      expect(projection?.revision).toBe(3);
    });
  });

  describe('review_appended', () => {
    function completedEvents(): InvestigationEvent[] {
      const intake = confirmedUserIntake({
        accountId: 'account-17',
        skuId: 'SKU-2002',
        seller: '1',
        quantity: 1,
        destinationPostalCode: '01310-100',
      });
      const outcome = buildInvestigationOutcome({
        kind: 'observed',
        ledger: createEvidenceLedger({ facts: satisfiedFacts() }),
        symptomReproduced: true,
      });
      return [
        {
          kind: 'investigation_created',
          investigationId: 'inv-1',
          occurredAt: '2026-07-30T12:00:00.000Z',
          intake,
          state: 'completed',
          outcome,
        },
      ];
    }

    it('appends a review without touching outcome, intake or state (AC3)', () => {
      const created = completedEvents();
      const before = foldInvestigationEvents(created);
      const review: InvestigationEvent = {
        kind: 'review_appended',
        investigationId: 'inv-1',
        occurredAt: '2026-07-30T12:05:00.000Z',
        review: {
          outcome: 'confirmed',
          reviewerName: 'ana',
          automatedFindingCode: 'DESTINATION_NOT_COVERED',
          occurredAt: '2026-07-30T12:05:00.000Z',
        },
      };

      const after = foldInvestigationEvents([...created, review]);

      expect(after?.reviews).toEqual([review.review]);
      expect(after?.revision).toBe(2);
      expect(after?.outcome).toEqual(before?.outcome);
      expect(after?.intake).toEqual(before?.intake);
      expect(after?.state).toBe(before?.state);
    });

    it('a second review appends rather than replaces the first (AC3: previous reviews remain immutable and visible)', () => {
      const created = completedEvents();
      const first: InvestigationEvent = {
        kind: 'review_appended',
        investigationId: 'inv-1',
        occurredAt: '2026-07-30T12:05:00.000Z',
        review: {
          outcome: 'inconclusive',
          reviewerName: 'ana',
          automatedFindingCode: 'DESTINATION_NOT_COVERED',
          reason: 'missing_evidence',
          occurredAt: '2026-07-30T12:05:00.000Z',
        },
      };
      const second: InvestigationEvent = {
        kind: 'review_appended',
        investigationId: 'inv-1',
        occurredAt: '2026-07-30T12:10:00.000Z',
        review: {
          outcome: 'corrected',
          reviewerName: 'bruno',
          automatedFindingCode: 'DESTINATION_NOT_COVERED',
          correctedFindingCode: 'ROOT_CAUSE_UNDETERMINED',
          reason: 'conflicting_evidence',
          occurredAt: '2026-07-30T12:10:00.000Z',
        },
      };

      const projection = foldInvestigationEvents([...created, first, second]);

      expect(projection?.reviews).toEqual([first.review, second.review]);
      expect(projection?.revision).toBe(3);
    });

    it('is a no-op when there is no preceding investigation_created (defends against corrupt/partial history)', () => {
      const orphan: InvestigationEvent = {
        kind: 'review_appended',
        investigationId: 'inv-1',
        occurredAt: '2026-07-30T12:00:00.000Z',
        review: {
          outcome: 'confirmed',
          reviewerName: 'ana',
          automatedFindingCode: 'DESTINATION_NOT_COVERED',
          occurredAt: '2026-07-30T12:00:00.000Z',
        },
      };
      expect(foldInvestigationEvents([orphan])).toBeUndefined();
    });

    it('a later intake_updated event that reruns the playbook leaves earlier reviews and their captured automatedFindingCode untouched', () => {
      const created = completedEvents();
      const review: InvestigationEvent = {
        kind: 'review_appended',
        investigationId: 'inv-1',
        occurredAt: '2026-07-30T12:05:00.000Z',
        review: {
          outcome: 'confirmed',
          reviewerName: 'ana',
          automatedFindingCode: 'DESTINATION_NOT_COVERED',
          occurredAt: '2026-07-30T12:05:00.000Z',
        },
      };
      const recomputed: InvestigationEvent = {
        kind: 'intake_updated',
        investigationId: 'inv-1',
        occurredAt: '2026-07-30T12:10:00.000Z',
        intake: confirmedUserIntake({
          accountId: 'account-17',
          skuId: 'SKU-2002',
          seller: '2',
          quantity: 1,
          destinationPostalCode: '01310-100',
        }),
        state: 'completed',
        outcome: buildInvestigationOutcome({
          kind: 'insufficient-evidence',
          failure: { kind: 'permission_denied', capability: 'inventory', message: 'denied' },
        }),
      };

      const projection = foldInvestigationEvents([...created, review, recomputed]);

      expect(projection?.reviews).toEqual([review.review]);
      expect(projection?.reviews[0]?.automatedFindingCode).toBe('DESTINATION_NOT_COVERED');
      expect(projection?.outcome?.findingCode).toBe('ROOT_CAUSE_UNDETERMINED');
    });
  });
});
