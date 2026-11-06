/** The fields Language Assistance may propose. Account Scope is absent, so it cannot be requested. */
export type ExtractableIntakeField = 'skuId' | 'seller' | 'quantity' | 'destinationPostalCode';

export interface ExtractedIntakeFields {
  readonly skuId?: string;
  readonly seller?: string;
  readonly quantity?: number;
  readonly destinationPostalCode?: string;
}

export interface IntakeExtractionRequest {
  readonly ticketText: string;
  /** Only fields the caller has not already resolved from explicit intake — extraction never overrides an explicit value. */
  readonly fields: readonly ExtractableIntakeField[];
}

export type IntakeExtractionResult =
  | { readonly kind: 'extracted'; readonly fields: ExtractedIntakeFields }
  | { readonly kind: 'unavailable'; readonly reason: string };

/**
 * Everything the model may know when improving one explanation. Plain strings,
 * because this module does not import `domain/` (ADR-0042).
 *
 * `allowedPlaceholderNames` carries names only, never values: the model refers
 * to a fact as `{{skuId}}` and cannot retype an identifier it never received.
 * `deterministicSummary` is the template text, which has no case-specific
 * identifiers.
 */
export interface ExplanationImprovementRequest {
  readonly findingCode: string;
  readonly decision: string;
  readonly decisionReason: string;
  readonly deterministicSummary: string;
  readonly allowedPlaceholderNames: readonly string[];
  readonly sourcePackUrls: readonly string[];
}

/**
 * `summaryTemplate` must use only `{{placeholderName}}` tokens from
 * `allowedPlaceholderNames` for any case-specific fact — the caller
 * substitutes real values only after `domain/explanation-improvement.ts`'s
 * grounding check accepts the proposal. `unavailable`
 * covers an ordinary model/provider failure the same way
 * `IntakeExtractionResult` does — never thrown, always reported, so a
 * caller falls back to the deterministic explanation instead of every call
 * site needing its own try/catch around an unbounded error type.
 */
export type ExplanationImprovementResult =
  | { readonly kind: 'improved'; readonly summaryTemplate: string; readonly citedSourceUrls: readonly string[] }
  | { readonly kind: 'unavailable'; readonly reason: string };

/**
 * CONTEXT.md's Language Assistance: a bounded, degradable use of AI to
 * propose Investigation Intake from ticket text, or, on explicit request,
 * improve a deterministic Finding explanation. Neither method ever throws
 * for an ordinary model/provider failure — both report `kind: 'unavailable'`
 * so a caller can fall back instead of
 * every call site needing its own try/catch around an unbounded error type.
 */
export interface LanguageAssistance {
  extractIntake(request: IntakeExtractionRequest): Promise<IntakeExtractionResult>;
  improveExplanation(request: ExplanationImprovementRequest): Promise<ExplanationImprovementResult>;
}
