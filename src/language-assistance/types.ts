/**
 * The non-Account-Scope fields Language Assistance may propose from
 * unstructured ticket text. `accountId` is intentionally
 * absent from this union — nothing that consumes it can ask an
 * `IntakeExtractionRequest` to extract Account Scope, and the Bedrock
 * implementation's schema has no key for it either.
 */
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
 * `LanguageAssistance.improveExplanation`'s request:
 * everything the model is allowed to know about one completed
 * Investigation's deterministic Finding Source Pack explanation, to
 * improve wording and next-action guidance on. Deliberately domain-agnostic
 * plain strings — this module has no import from `domain/` (ADR-0042) — so
 * `domain/explanation-improvement.ts` is the one seam that translates
 * `FindingCode`/`InvestigationDecision`/`DecisionReason` into these fields.
 *
 * `allowedPlaceholderNames` carries only placeholder *names*
 * (`"skuId"`, `"destinationPostalCode"`, …), never their real values: the
 * model must reference a specific fact as `{{skuId}}` in `summaryTemplate`,
 * not retype or invent one, because it never receives the literal value to
 * retype in the first place. `deterministicSummary` is the existing
 * template-based prose (`buildFindingExplanation`), itself already free of
 * any case-specific identifier, given only as tone and content reference.
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
