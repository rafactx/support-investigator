import type { LanguageAssistance } from './types.ts';

/**
 * Reports every call as `unavailable`, so a provider that cannot be reached
 * (for example, missing credentials) degrades to the deterministic path
 * instead of failing at startup. `reason` is for server-side diagnostics; the
 * API never returns it to clients.
 */
export function unavailableLanguageAssistance(reason: string): LanguageAssistance {
  return {
    async extractIntake() {
      return { kind: 'unavailable', reason };
    },
    async improveExplanation() {
      return { kind: 'unavailable', reason };
    },
  };
}
