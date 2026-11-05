import type {
  ExplanationImprovementRequest,
  ExplanationImprovementResult,
  ExtractedIntakeFields,
  IntakeExtractionRequest,
  IntakeExtractionResult,
  LanguageAssistance,
} from './types.ts';

export type FakeExtractionScript = (request: IntakeExtractionRequest) => IntakeExtractionResult;
export type FakeExplanationScript = (request: ExplanationImprovementRequest) => ExplanationImprovementResult;

/** The default `explanationScript` when a caller passes only the older single-arg form — degrades the same way `NO_OP_LANGUAGE_ASSISTANCE` does, never silently "succeeding" with an unrequested script. */
const DEFAULT_EXPLANATION_SCRIPT: FakeExplanationScript = () => ({
  kind: 'unavailable',
  reason: 'no explanation script configured',
});

/**
 * A deterministic, no-network Language Assistance fake for tests and CI
 * ("a deterministic fake Language Assistance implementation
 * keeps normal CI credential-free"). Unlike `FakeScriptedModel`
 * (`src/evals/fake-model.ts`), this fake is shaped around this port's own
 * `IntakeExtractionRequest`/`Result` and `ExplanationImprovementRequest`/
 * `Result` contracts, not Strands' streaming event protocol — the two are
 * not interchangeable.
 *
 * `script` receives the exact request (ticket text and the fields still
 * needed) so a caller can script a deliberate miss (omit a field), an
 * ambiguous case (also omit it — Language Assistance never guesses) or an
 * invented identifier (a value absent from the ticket text) per labeled
 * eval ticket. `explanationScript` is optional and separate —
 * every existing single-arg call site keeps compiling and degrades to
 * `unavailable` for `improveExplanation` rather than acquiring an
 * unrequested behavior.
 */
export function createFakeLanguageAssistance(
  script: FakeExtractionScript,
  explanationScript: FakeExplanationScript = DEFAULT_EXPLANATION_SCRIPT,
): LanguageAssistance {
  return {
    async extractIntake(request) {
      return script(request);
    },
    async improveExplanation(request) {
      return explanationScript(request);
    },
  };
}

/** Proposes the same fixed values for whichever fields are requested — a convenience script for the common case. */
export function fixedFieldsScript(fields: ExtractedIntakeFields): FakeExtractionScript {
  return (request) => {
    const proposed: Record<string, string | number> = {};
    for (const field of request.fields) {
      const value = fields[field];
      if (value !== undefined) {
        proposed[field] = value;
      }
    }
    return { kind: 'extracted', fields: proposed as ExtractedIntakeFields };
  };
}

/** Reports Language Assistance as unavailable regardless of the request — for AC7's "usable when Bedrock is unavailable" tests. */
export function unavailableScript(reason = 'Language Assistance is unavailable'): FakeExtractionScript {
  return () => ({ kind: 'unavailable', reason });
}

/**
 * Proposes a deliberately generic, digit-free, placeholder-free rewrite
 * that cites every URL the request allowlisted — always passes
 * `checkExplanationGrounding` regardless of which Investigation it's
 * scripted against, so it's a safe default for "improvement
 * succeeds" tests without needing to know the case's specific facts.
 */
export function groundedImprovementScript(
  overrides: { readonly summaryTemplate?: string; readonly citedSourceUrls?: readonly string[] } = {},
): FakeExplanationScript {
  return (request) => ({
    kind: 'improved',
    summaryTemplate: overrides.summaryTemplate ?? 'Here is a clearer explanation of this finding and what to do next.',
    citedSourceUrls: overrides.citedSourceUrls ?? request.sourcePackUrls,
  });
}

/** Reports explanation improvement as unavailable regardless of the request — for AC7's "Bedrock failure" tests. */
export function explanationUnavailableScript(reason = 'Language Assistance is unavailable'): FakeExplanationScript {
  return () => ({ kind: 'unavailable', reason });
}

/**
 * Proposes a fabricated identifier that was never in the allowed
 * placeholders, and cites a URL outside the pinned Source Pack —
 * deliberately ungrounded, for the grounding-rejection tests.
 */
export function fabricatedIdentifierImprovementScript(): FakeExplanationScript {
  return () => ({
    kind: 'improved',
    summaryTemplate: 'This case involves SKU 999999, which was never part of the confirmed intake or Evidence Ledger.',
    citedSourceUrls: ['https://example.invalid/not-in-the-pinned-source-pack'],
  });
}
