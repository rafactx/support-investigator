import { describe, expect, it } from 'vitest';
import {
  createFakeLanguageAssistance,
  explanationUnavailableScript,
  fabricatedIdentifierImprovementScript,
  fixedFieldsScript,
  groundedImprovementScript,
  unavailableScript,
} from './fake-language-assistance.ts';
import type { ExplanationImprovementRequest } from './types.ts';

const EXPLANATION_REQUEST: ExplanationImprovementRequest = {
  findingCode: 'DESTINATION_NOT_COVERED',
  decision: 'ready_for_human_resolution',
  decisionReason: 'contract_satisfied',
  deterministicSummary: 'Deterministic summary text.',
  allowedPlaceholderNames: ['skuId', 'seller'],
  sourcePackUrls: ['https://example.com/a', 'https://example.com/b'],
};

describe('createFakeLanguageAssistance', () => {
  it('is deterministic and only proposes fields the caller asked for', async () => {
    const languageAssistance = createFakeLanguageAssistance(
      fixedFieldsScript({ skuId: 'SKU-2002', seller: '1', destinationPostalCode: '01310-100' }),
    );

    const result = await languageAssistance.extractIntake({
      ticketText: 'SKU-2002 has stock but nothing ships to 01310-100.',
      fields: ['skuId', 'destinationPostalCode'],
    });

    expect(result).toEqual({
      kind: 'extracted',
      fields: { skuId: 'SKU-2002', destinationPostalCode: '01310-100' },
    });
  });

  it('omits a field the script has no value for, modeling a deliberate miss or ambiguous case', async () => {
    const languageAssistance = createFakeLanguageAssistance(fixedFieldsScript({ skuId: 'SKU-2002' }));

    const result = await languageAssistance.extractIntake({
      ticketText: 'Ambiguous ticket text.',
      fields: ['skuId', 'seller'],
    });

    expect(result).toEqual({ kind: 'extracted', fields: { skuId: 'SKU-2002' } });
  });

  it('can script an invented identifier absent from the ticket text, for invented-identifier-rate tests', async () => {
    const languageAssistance = createFakeLanguageAssistance(fixedFieldsScript({ skuId: 'SKU-INVENTED-999' }));

    const result = await languageAssistance.extractIntake({
      ticketText: 'The customer mentions no SKU at all.',
      fields: ['skuId'],
    });

    expect(result.kind).toBe('extracted');
    expect(result.kind === 'extracted' && result.fields.skuId).toBe('SKU-INVENTED-999');
  });

  it('unavailableScript reports Language Assistance as unavailable regardless of the request', async () => {
    const languageAssistance = createFakeLanguageAssistance(unavailableScript('Bedrock outage'));

    const result = await languageAssistance.extractIntake({
      ticketText: 'Anything at all.',
      fields: ['skuId', 'seller', 'quantity', 'destinationPostalCode'],
    });

    expect(result).toEqual({ kind: 'unavailable', reason: 'Bedrock outage' });
  });

  it('defaults improveExplanation to unavailable when no explanationScript is given (single-arg call sites keep the old degraded behavior)', async () => {
    const languageAssistance = createFakeLanguageAssistance(fixedFieldsScript({}));

    const result = await languageAssistance.improveExplanation(EXPLANATION_REQUEST);

    expect(result.kind).toBe('unavailable');
  });

  it('groundedImprovementScript always cites the request’s own sourcePackUrls', async () => {
    const languageAssistance = createFakeLanguageAssistance(fixedFieldsScript({}), groundedImprovementScript());

    const result = await languageAssistance.improveExplanation(EXPLANATION_REQUEST);

    expect(result).toEqual({
      kind: 'improved',
      summaryTemplate: expect.any(String),
      citedSourceUrls: EXPLANATION_REQUEST.sourcePackUrls,
    });
  });

  it('explanationUnavailableScript reports explanation improvement as unavailable regardless of the request', async () => {
    const languageAssistance = createFakeLanguageAssistance(
      fixedFieldsScript({}),
      explanationUnavailableScript('Bedrock outage'),
    );

    const result = await languageAssistance.improveExplanation(EXPLANATION_REQUEST);

    expect(result).toEqual({ kind: 'unavailable', reason: 'Bedrock outage' });
  });

  it('fabricatedIdentifierImprovementScript proposes an off-pack citation, for rejection tests', async () => {
    const languageAssistance = createFakeLanguageAssistance(
      fixedFieldsScript({}),
      fabricatedIdentifierImprovementScript(),
    );

    const result = await languageAssistance.improveExplanation(EXPLANATION_REQUEST);

    expect(result.kind).toBe('improved');
    expect(result.kind === 'improved' && result.citedSourceUrls).not.toEqual(
      expect.arrayContaining([...EXPLANATION_REQUEST.sourcePackUrls]),
    );
  });
});
