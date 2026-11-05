import { describe, expect, it } from 'vitest';
import { MockLanguageModelV4 } from 'ai/test';
import {
  buildIntakeExtractionOutputSchema,
  createModelLanguageAssistance,
  normalizeExtractedIntakeFields,
} from './model-language-assistance.ts';

const ALL = ['skuId', 'seller', 'quantity', 'destinationPostalCode'] as const;

describe('buildIntakeExtractionOutputSchema', () => {
  it('makes every requested field required but nullable, so the model decides per field', async () => {
    const schema = await buildIntakeExtractionOutputSchema(ALL).jsonSchema;
    expect(schema).toMatchObject({
      type: 'object',
      required: [...ALL],
      additionalProperties: false,
    });
    const properties = (
      schema as { properties: Record<string, { type: string[] }> }
    ).properties;
    expect(properties.skuId.type).toEqual(['string', 'null']);
    expect(properties.quantity.type).toEqual(['integer', 'null']);
    expect(Object.keys(properties)).not.toContain('accountId');
  });
});

describe('normalizeExtractedIntakeFields', () => {
  it('drops nulls and the literal string "null"', () => {
    expect(
      normalizeExtractedIntakeFields({
        skuId: null,
        seller: 'null',
        quantity: null,
        destinationPostalCode: null,
      }),
    ).toEqual({});
  });

  it('strips a spelled-out seller prefix and trims', () => {
    expect(
      normalizeExtractedIntakeFields({
        seller: ' seller 1 ',
        skuId: ' SKU-2002',
      }),
    ).toEqual({ seller: '1', skuId: 'SKU-2002' });
  });

  it('drops values that are not shaped like identifiers instead of repairing them', () => {
    expect(
      normalizeExtractedIntakeFields({
        destinationPostalCode: '01310-100”, ',
        skuId: 'SKU 2002, seller 1',
        quantity: 0,
      }),
    ).toEqual({});
    expect(
      normalizeExtractedIntakeFields({
        destinationPostalCode: '01310-100',
        quantity: 2,
      }),
    ).toEqual({
      destinationPostalCode: '01310-100',
      quantity: 2,
    });
  });
});

describe('createModelLanguageAssistance.extractIntake', () => {
  it('asks at temperature 0 and returns normalized fields', async () => {
    let temperature: number | undefined;
    const model = new MockLanguageModelV4({
      doGenerate: async (options) => {
        temperature = options.temperature;
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                skuId: 'SKU-2002',
                seller: 'seller 1',
                quantity: 1,
                destinationPostalCode: null,
              }),
            },
          ],
          finishReason: { unified: 'stop', raw: undefined },
          usage: {
            inputTokens: {
              total: 1,
              noCache: 1,
              cacheRead: undefined,
              cacheWrite: undefined,
            },
            outputTokens: { total: 1, text: 1, reasoning: undefined },
          },
          warnings: [],
        };
      },
    });
    const result = await createModelLanguageAssistance(model).extractIntake({
      ticketText: 't',
      fields: [...ALL],
    });
    expect(temperature).toBe(0);
    expect(result).toEqual({
      kind: 'extracted',
      fields: { skuId: 'SKU-2002', seller: '1', quantity: 1 },
    });
  });
});
