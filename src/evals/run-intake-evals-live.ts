import { createLanguageAssistance } from '../language-assistance/create-language-assistance.ts';
import {
  isEntireLiveIntakeEvalUnavailable,
  printIntakeEvalReport,
  runIntakeExtractionEval,
} from './intake-extraction-metrics.ts';
import { INTAKE_GOLDEN_TICKETS } from './intake-golden-tickets.ts';

/**
 * `pnpm evals:intake:live` — informational, non-gating. Runs the same
 * labeled PT/EN ticket suite `pnpm evals:intake` runs deterministically,
 * but against a real model: `LANGUAGE_MODEL_PROVIDER` when set, otherwise
 * Bedrock. Never sets a non-zero exit code on a metric miss; a
 * thrown/unexpected error still fails loud.
 */
async function main(): Promise<void> {
  const { provider, languageAssistance } = createLanguageAssistance(process.env, 'bedrock');
  const report = await runIntakeExtractionEval(INTAKE_GOLDEN_TICKETS, languageAssistance);
  printIntakeEvalReport(report, `live ${provider}`);
  if (isEntireLiveIntakeEvalUnavailable(report)) {
    console.log(`\nSKIPPED: live ${provider} credentials or model access were unavailable; no quality result was recorded.`);
  }
  process.exitCode = 0;
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
