import { describe, expect, it } from 'vitest';
import { createFakeLanguageAssistance, fixedFieldsScript, unavailableScript } from '../language-assistance/fake-language-assistance.ts';
import { isEntireLiveIntakeEvalUnavailable, runIntakeExtractionEval } from './intake-extraction-metrics.ts';
import { createScriptedIntakeLanguageAssistance, INTAKE_GOLDEN_TICKETS } from './intake-golden-tickets.ts';

describe('INTAKE_GOLDEN_TICKETS', () => {
  it('has at least 30 tickets spanning both English and Portuguese', () => {
    expect(INTAKE_GOLDEN_TICKETS.length).toBeGreaterThanOrEqual(30);
    expect(INTAKE_GOLDEN_TICKETS.some((t) => t.language === 'en')).toBe(true);
    expect(INTAKE_GOLDEN_TICKETS.some((t) => t.language === 'pt')).toBe(true);
  });

  it('every ticket id is unique', () => {
    const ids = INTAKE_GOLDEN_TICKETS.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('runIntakeExtractionEval', () => {
  it('a perfect extractor scores precision 1 and recall 1 on every field with a positive case', async () => {
    const perfect = createFakeLanguageAssistance((request) => {
      const fields: Record<string, string | number> = {};
      for (const field of request.fields) {
        // Every golden ticket's own `expected` is grounded in its ticketText by construction.
        const ticket = INTAKE_GOLDEN_TICKETS.find((t) => t.ticketText === request.ticketText);
        const value = ticket?.expected[field];
        if (value !== undefined) fields[field] = value;
      }
      return { kind: 'extracted', fields: fields as never };
    });

    const report = await runIntakeExtractionEval(INTAKE_GOLDEN_TICKETS, perfect);

    for (const metrics of report.perField) {
      if (metrics.precision !== undefined) expect(metrics.precision).toBe(1);
      if (metrics.recall !== undefined) expect(metrics.recall).toBe(1);
      expect(metrics.invented).toBe(0);
    }
    expect(report.inventedIdentifierRate).toBe(0);
    expect(report.allProposalsUnconfirmed).toBe(true);
  });

  it('an extractor that never proposes anything scores recall 0 wherever a positive case exists, and is never penalized on precision', async () => {
    const nothing = createFakeLanguageAssistance(fixedFieldsScript({}));
    const report = await runIntakeExtractionEval(INTAKE_GOLDEN_TICKETS, nothing);

    for (const metrics of report.perField) {
      expect(metrics.truePositives).toBe(0);
      expect(metrics.precision).toBeUndefined(); // nothing was ever proposed
      if (metrics.recall !== undefined) expect(metrics.recall).toBe(0);
    }
    expect(report.inventedIdentifierRate).toBe(0);
  });

  it('the scripted gating harness detects its own two deliberately-wrong tickets as non-zero invented/false-positive signal (proves the metric machinery is a real detector)', async () => {
    const scripted = createScriptedIntakeLanguageAssistance();
    const report = await runIntakeExtractionEval(INTAKE_GOLDEN_TICKETS, scripted);

    const quantityMetrics = report.perField.find((m) => m.field === 'quantity');
    expect(quantityMetrics?.falsePositives).toBeGreaterThanOrEqual(2); // intake-en-09 / intake-pt-09's decoy price

    const skuMetrics = report.perField.find((m) => m.field === 'skuId');
    expect(skuMetrics?.invented).toBeGreaterThanOrEqual(2); // intake-en-14 / intake-pt-14's fabricated SKU

    expect(report.inventedIdentifierRate).toBeGreaterThan(0);
    // The metric machinery is not stuck reporting perfection even though most tickets are clean.
    expect(quantityMetrics?.precision).toBeLessThan(1);
    expect(skuMetrics?.precision).toBeLessThan(1);
  });

  it('the ambiguous-ticket case correctly credits an abstaining extractor with a true negative, not a false negative', async () => {
    const abstaining = createScriptedIntakeLanguageAssistance();
    const report = await runIntakeExtractionEval(
      INTAKE_GOLDEN_TICKETS.filter((t) => t.id === 'intake-en-07'),
      abstaining,
    );
    const skuOutcome = report.results[0]?.fields.find((f) => f.field === 'skuId');
    expect(skuOutcome?.outcome).toBe('true_negative');
  });

  it('reports allProposalsUnconfirmed even for a suite where every field is proposed — the invariant is structural, not dependent on ticket mix', async () => {
    const alwaysProposes = createFakeLanguageAssistance(
      fixedFieldsScript({ skuId: 'SKU-2002', seller: '1', quantity: 1, destinationPostalCode: '01310-100' }),
    );
    const report = await runIntakeExtractionEval(INTAKE_GOLDEN_TICKETS, alwaysProposes);
    expect(report.allProposalsUnconfirmed).toBe(true);
  });

  it('a suite entirely served by unavailableScript reports zero proposals across every field', async () => {
    const unavailable = createFakeLanguageAssistance(unavailableScript());
    const report = await runIntakeExtractionEval(INTAKE_GOLDEN_TICKETS, unavailable);
    expect(report.results.every((r) => r.unavailable)).toBe(true);
    for (const metrics of report.perField) {
      expect(metrics.truePositives).toBe(0);
      expect(metrics.falsePositives).toBe(0);
      expect(metrics.invented).toBe(0);
    }
    expect(isEntireLiveIntakeEvalUnavailable(report)).toBe(true);
  });

  it('does not label a partially available live run as skipped', async () => {
    const report = await runIntakeExtractionEval(
      INTAKE_GOLDEN_TICKETS.slice(0, 2),
      createFakeLanguageAssistance(fixedFieldsScript({ skuId: 'SKU-2002' })),
    );
    expect(isEntireLiveIntakeEvalUnavailable(report)).toBe(false);
  });
});
