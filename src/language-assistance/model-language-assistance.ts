import { generateText, jsonSchema, Output, type LanguageModel } from 'ai';
import { z } from 'zod';
import type {
  ExplanationImprovementRequest,
  ExplanationImprovementResult,
  ExtractableIntakeField,
  ExtractedIntakeFields,
  IntakeExtractionRequest,
  IntakeExtractionResult,
  LanguageAssistance,
} from './types.ts';

/** One model call must leave room for capability work and a durable commit in the request budget. */
export const LANGUAGE_ASSISTANCE_TIMEOUT_MS = 4_000;

/** The longest per-call timeout a deployment may configure; past this the request itself is the problem. */
export const MAX_LANGUAGE_ASSISTANCE_TIMEOUT_MS = 20_000;

export interface ModelLanguageAssistanceOptions {
  /**
   * Per-call abort timeout. Defaults to `LANGUAGE_ASSISTANCE_TIMEOUT_MS`;
   * a provider whose cold-start latency is higher may raise it, up to
   * `MAX_LANGUAGE_ASSISTANCE_TIMEOUT_MS`.
   */
  readonly timeoutMs?: number;
}

/**
 * Reads an optional timeout override (`LANGUAGE_ASSISTANCE_TIMEOUT_MS`).
 * Anything that is not an integer between 1 ms and the ceiling falls back
 * to the default, so a typo cannot disable the bound.
 */
export function readLanguageAssistanceTimeoutMs(
  raw: string | undefined,
): number {
  const value = raw === undefined ? Number.NaN : Number(raw);
  return Number.isInteger(value) &&
    value > 0 &&
    value <= MAX_LANGUAGE_ASSISTANCE_TIMEOUT_MS
    ? value
    : LANGUAGE_ASSISTANCE_TIMEOUT_MS;
}

/**
 * Hard ceilings on generated tokens per call — the per-call half of the
 * spend bound on any deployment. The structured outputs are small:
 * a handful of intake fields, or one paragraph plus citations.
 */
export const INTAKE_EXTRACTION_MAX_OUTPUT_TOKENS = 300;
const EXPLANATION_IMPROVEMENT_MAX_OUTPUT_TOKENS = 700;

const FIELD_SCHEMAS: Record<ExtractableIntakeField, z.ZodTypeAny> = {
  skuId: z.string().min(1),
  seller: z.string().min(1),
  quantity: z.number().int().positive(),
  destinationPostalCode: z.string().min(1),
};

/** Only the requested fields. Account Scope has no key, so a proposal cannot contain it. */
export function buildIntakeExtractionSchema(
  fields: readonly ExtractableIntakeField[],
) {
  const shape: Record<string, z.ZodTypeAny> = {};
  for (const field of fields) {
    shape[field] = FIELD_SCHEMAS[field].nullish();
  }
  return z.strictObject(shape);
}

const FIELD_JSON_SCHEMAS: Record<
  ExtractableIntakeField,
  { type: 'string' | 'integer'; description: string }
> = {
  skuId: {
    type: 'string',
    description:
      'Product SKU exactly as written in the ticket, e.g. "SKU-2002"; null if not stated.',
  },
  seller: {
    type: 'string',
    description:
      'Seller identifier exactly as written, e.g. "1" for "seller 1"; null if not stated.',
  },
  quantity: {
    type: 'integer',
    description:
      'Number of units the customer tried to buy; null if not stated.',
  },
  destinationPostalCode: {
    type: 'string',
    description:
      'Destination postal code exactly as written, e.g. "01310-100"; null if not stated.',
  },
};

/**
 * The schema the model is constrained by. Every requested field is
 * REQUIRED but nullable: with optional keys, smaller open models (Llama 3.3
 * on Workers AI) tend to stop after the first field they find, while a
 * required key forces a decision per field and `null` keeps "not stated"
 * expressible. Parsing still goes through the Zod schema above.
 */
export function buildIntakeExtractionOutputSchema(
  fields: readonly ExtractableIntakeField[],
) {
  const zodSchema = buildIntakeExtractionSchema(fields);
  const properties: Record<
    string,
    { type: [string, 'null']; description: string }
  > = {};
  for (const field of fields) {
    const { type, description } = FIELD_JSON_SCHEMAS[field];
    properties[field] = { type: [type, 'null'], description };
  }
  return jsonSchema<Record<string, unknown>>(
    {
      type: 'object',
      properties,
      required: [...fields],
      additionalProperties: false,
    },
    {
      validate: (value) => {
        const parsed = zodSchema.safeParse(value);
        return parsed.success
          ? { success: true, value: parsed.data as Record<string, unknown> }
          : { success: false, error: parsed.error };
      },
    },
  );
}

const IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const POSTAL_CODE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9 -]{1,14}[A-Za-z0-9]$/;

/**
 * Deterministic clean-up of a model proposal before anyone sees it: drops
 * nulls, trims, strips a spelled-out "seller " prefix, and drops any value
 * that is not shaped like an identifier (stray quotes, commas, the string
 * "null"). A dropped value becomes an intake gap the operator fills; it is
 * never repaired into something the ticket did not say.
 */
export function normalizeExtractedIntakeFields(
  raw: Record<string, unknown>,
): ExtractedIntakeFields {
  const result: {
    -readonly [K in keyof ExtractedIntakeFields]: ExtractedIntakeFields[K];
  } = {};
  const text = (value: unknown): string | undefined => {
    if (typeof value !== 'string') return undefined;
    const trimmed = value.trim();
    return trimmed === '' || trimmed.toLowerCase() === 'null'
      ? undefined
      : trimmed;
  };
  const sku = text(raw.skuId);
  if (sku && IDENTIFIER_PATTERN.test(sku)) result.skuId = sku;
  const seller = text(raw.seller)?.replace(/^seller\s+/i, '');
  if (seller && IDENTIFIER_PATTERN.test(seller)) result.seller = seller;
  if (
    typeof raw.quantity === 'number' &&
    Number.isInteger(raw.quantity) &&
    raw.quantity > 0
  ) {
    result.quantity = raw.quantity;
  }
  const postal = text(raw.destinationPostalCode);
  if (postal && POSTAL_CODE_PATTERN.test(postal))
    result.destinationPostalCode = postal;
  return result;
}

const EXTRACTION_SYSTEM_PROMPT = `You extract structured fields from a support ticket's raw text for a fulfillment
investigation. Only propose a value when it is explicitly present in the ticket text — never
infer, guess or fabricate an identifier. Copy identifiers exactly as written. Use null for a
field the ticket text does not state, or is ambiguous about. You have no access to and must never propose an account,
merchant or customer identity — that is supplied separately and is outside your task.`;

/** A rewrite of an already-correct explanation, so the output is one short paragraph. */
const ExplanationImprovementSchema = z.strictObject({
  summaryTemplate: z.string().min(1).max(1200),
  citedSourceUrls: z.array(z.string().min(1)).min(1).max(5),
});

/**
 * The model gets placeholder names instead of identifiers and a fixed list of
 * citable URLs. The prompt is instruction only; `checkExplanationGrounding`
 * enforces both rules afterwards.
 */
function buildExplanationImprovementSystemPrompt(
  request: ExplanationImprovementRequest,
): string {
  const placeholderList =
    request.allowedPlaceholderNames.length > 0
      ? request.allowedPlaceholderNames.map((name) => `{{${name}}}`).join(', ')
      : '(no placeholders are available for this case)';
  const sourceList = request.sourcePackUrls.map((url) => `- ${url}`).join('\n');

  return `You improve the wording and next-action guidance of a deterministic support-investigation
explanation. You are given the Finding Code, Investigation Decision, Decision Reason and the current
deterministic explanation — never any raw case data.

Reference a specific fact only by writing its placeholder token exactly as listed here, wrapped in
double curly braces: ${placeholderList}. Never write a digit, SKU, postal code, warehouse, dock or
policy identifier yourself — you were not given any real value to write, only these placeholder
names. Never invent, rename or guess a placeholder that is not in this list.

Cite only from this exact list of Finding Source Pack URLs — never any other URL:
${sourceList}

Return a rewritten explanation ("summaryTemplate") using only the given placeholders for any
specific fact, plus the URLs you actually relied on ("citedSourceUrls"), a non-empty subset of the
list above.`;
}

/**
 * Language Assistance over any AI SDK `LanguageModel`: one bounded
 * `generateText` call with structured output, no agent loop, no tools. Ticket
 * text is used only as the prompt. Provider modules pick the model and may
 * raise the timeout; prompts, schemas and limits live here.
 */
export function createModelLanguageAssistance(
  resolvedModel: LanguageModel,
  options: ModelLanguageAssistanceOptions = {},
): LanguageAssistance {
  const timeoutMs = options.timeoutMs ?? LANGUAGE_ASSISTANCE_TIMEOUT_MS;
  return {
    async extractIntake(
      request: IntakeExtractionRequest,
    ): Promise<IntakeExtractionResult> {
      if (request.fields.length === 0) {
        return { kind: 'extracted', fields: {} };
      }
      try {
        const { output } = await generateText({
          model: resolvedModel,
          system: EXTRACTION_SYSTEM_PROMPT,
          prompt: request.ticketText,
          maxOutputTokens: INTAKE_EXTRACTION_MAX_OUTPUT_TOKENS,
          temperature: 0,
          abortSignal: AbortSignal.timeout(timeoutMs),
          output: Output.object({
            schema: buildIntakeExtractionOutputSchema(request.fields),
          }),
        });
        return {
          kind: 'extracted',
          fields: normalizeExtractedIntakeFields(output),
        };
      } catch (error) {
        return {
          kind: 'unavailable',
          reason:
            error instanceof Error
              ? error.message
              : 'Language Assistance extraction failed',
        };
      }
    },

    async improveExplanation(
      request: ExplanationImprovementRequest,
    ): Promise<ExplanationImprovementResult> {
      try {
        const { output } = await generateText({
          model: resolvedModel,
          system: buildExplanationImprovementSystemPrompt(request),
          prompt: [
            `Finding Code: ${request.findingCode}`,
            `Investigation Decision: ${request.decision}`,
            `Decision Reason: ${request.decisionReason}`,
            `Deterministic explanation to improve on: ${request.deterministicSummary}`,
          ].join('\n'),
          maxOutputTokens: EXPLANATION_IMPROVEMENT_MAX_OUTPUT_TOKENS,
          abortSignal: AbortSignal.timeout(timeoutMs),
          output: Output.object({ schema: ExplanationImprovementSchema }),
        });
        return {
          kind: 'improved',
          summaryTemplate: output.summaryTemplate,
          citedSourceUrls: output.citedSourceUrls,
        };
      } catch (error) {
        return {
          kind: 'unavailable',
          reason:
            error instanceof Error
              ? error.message
              : 'Language Assistance explanation improvement failed',
        };
      }
    },
  };
}
