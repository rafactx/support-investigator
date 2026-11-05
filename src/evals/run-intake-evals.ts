import { createScriptedIntakeLanguageAssistance, INTAKE_GOLDEN_TICKETS } from './intake-golden-tickets.ts';
import { printIntakeEvalReport, runIntakeExtractionEval } from './intake-extraction-metrics.ts';

/**
 * `pnpm evals:intake` — the credential-free, deterministic gate for
 * intake extraction. Runs the 30-ticket labeled PT/EN
 * suite against `createScriptedIntakeLanguageAssistance()` and fails the
 * process if the deliberately-wrong scripted tickets (AC9: false
 * positives, invented identifiers) stop producing the exact non-zero
 * signal this suite's own dataset was designed to prove — the same
 * "detector, not a check that only knows how to pass" property
 * `sabotage-check.ts` establishes for the policy gate. Live Bedrock
 * evaluation over the same 30 tickets is `pnpm evals:intake:live`,
 * deliberately non-gating.
 */
async function main(): Promise<void> {
  const report = await runIntakeExtractionEval(
    INTAKE_GOLDEN_TICKETS,
    createScriptedIntakeLanguageAssistance(INTAKE_GOLDEN_TICKETS),
  );
  printIntakeEvalReport(report, 'deterministic, credential-free');

  const failures: string[] = [];
  if (!report.allProposalsUnconfirmed) {
    failures.push('a proposed field was unconfirmed=false — a model proposal must never be pre-confirmed (AC4)');
  }
  if (report.inventedIdentifierRate === 0) {
    failures.push(
      'expected a non-zero invented-identifier rate — the dataset scripts deliberate fabrications ' +
        '(intake-en-14/intake-pt-14); a zero rate means the detector stopped catching them',
    );
  }
  const quantityMetrics = report.perField.find((m) => m.field === 'quantity');
  if ((quantityMetrics?.falsePositives ?? 0) === 0) {
    failures.push(
      'expected at least one quantity false positive — the dataset scripts a deliberate decoy-price ' +
        'miss (intake-en-09/intake-pt-09); zero false positives means the detector stopped catching it',
    );
  }

  if (failures.length > 0) {
    console.error('\nFAIL: intake extraction eval regression\n');
    for (const failure of failures) {
      console.error(`  - ${failure}`);
    }
    process.exitCode = 1;
    return;
  }

  console.log('\nPASS: intake extraction eval\n');
  process.exitCode = 0;
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
