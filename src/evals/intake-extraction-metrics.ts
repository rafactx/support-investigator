import { modelProposed } from '../domain/investigation.ts';
import type { ExtractableIntakeField, ExtractedIntakeFields, LanguageAssistance } from '../language-assistance/types.ts';
import type { IntakeGoldenTicket } from './intake-golden-tickets.ts';

const ALL_FIELDS: readonly ExtractableIntakeField[] = ['skuId', 'seller', 'quantity', 'destinationPostalCode'];

export type FieldOutcomeKind = 'true_positive' | 'false_positive' | 'false_negative' | 'true_negative' | 'invented';

export interface FieldOutcome {
  readonly field: ExtractableIntakeField;
  readonly expected: string | number | undefined;
  readonly proposed: string | number | undefined;
  readonly outcome: FieldOutcomeKind;
  /** Whether `modelProposed(proposed)` — the shape `buildIntake` actually constructs — is unconfirmed, as required. Always `true` when a value was proposed; the field is absent when nothing was proposed. */
  readonly unconfirmed?: boolean;
}

export interface TicketExtractionResult {
  readonly ticketId: string;
  readonly language: IntakeGoldenTicket['language'];
  readonly unavailable: boolean;
  readonly fields: readonly FieldOutcome[];
}

export interface FieldMetrics {
  readonly field: ExtractableIntakeField;
  readonly truePositives: number;
  readonly falsePositives: number;
  readonly falseNegatives: number;
  readonly trueNegatives: number;
  readonly invented: number;
  /** `undefined` when the field was never proposed anywhere in the suite (precision is undefined, not 0, for an empty denominator). */
  readonly precision: number | undefined;
  readonly recall: number | undefined;
}

export interface IntakeEvalReport {
  readonly ticketCount: number;
  readonly perField: readonly FieldMetrics[];
  /** Invented proposals / total proposals across every field and ticket. */
  readonly inventedIdentifierRate: number;
  /** True iff every proposed field in the whole run would be unconfirmed under `buildIntake`'s actual construction (the eval's "confirmation behavior" check). */
  readonly allProposalsUnconfirmed: boolean;
  readonly results: readonly TicketExtractionResult[];
}

/**
 * A live report with no successful provider responses contains no usable
 * quality measurement. Callers must show it as skipped/unavailable rather
 * than treating its zero-valued metrics as a passing score.
 */
export function isEntireLiveIntakeEvalUnavailable(report: IntakeEvalReport): boolean {
  return report.ticketCount > 0 && report.results.every((result) => result.unavailable);
}

function normalize(value: string | number): string {
  return String(value).trim().toLowerCase();
}

function valuesMatch(a: string | number | undefined, b: string | number | undefined): boolean {
  if (a === undefined || b === undefined) return false;
  return normalize(a) === normalize(b);
}

/** Whether `value` appears verbatim (case-insensitively) in the raw ticket text — the practical, text-grounding definition of "not invented" this harness uses. */
function isGroundedInText(value: string | number, ticketText: string): boolean {
  return normalize(ticketText).includes(normalize(value));
}

function classifyField(
  expected: string | number | undefined,
  proposed: string | number | undefined,
  ticketText: string,
): FieldOutcomeKind {
  if (proposed === undefined) {
    return expected === undefined ? 'true_negative' : 'false_negative';
  }
  if (expected !== undefined && valuesMatch(proposed, expected)) {
    return 'true_positive';
  }
  return isGroundedInText(proposed, ticketText) ? 'false_positive' : 'invented';
}

/**
 * Runs every ticket through `languageAssistance`, classifies each
 * requested field's outcome against the ticket's ground truth, and
 * aggregates per-field exact-match precision/recall, the overall
 * invented-identifier rate, and the confirmation-behavior invariant
 *. Precision is `truePositives / (truePositives +
 * falsePositives + invented)` — an invented value is a worse failure mode
 * than an ordinary false positive but still counts against precision, not
 * separately from it. Recall is `truePositives / (truePositives +
 * falseNegatives)`.
 */
export async function runIntakeExtractionEval(
  tickets: readonly IntakeGoldenTicket[],
  languageAssistance: LanguageAssistance,
): Promise<IntakeEvalReport> {
  const results: TicketExtractionResult[] = [];

  for (const ticket of tickets) {
    const extraction = await languageAssistance.extractIntake({
      ticketText: ticket.ticketText,
      fields: ticket.fieldsRequested,
    });
    const proposedFields: ExtractedIntakeFields = extraction.kind === 'extracted' ? extraction.fields : {};

    const fields: FieldOutcome[] = ticket.fieldsRequested.map((field) => {
      const expected = ticket.expected[field];
      const proposed = proposedFields[field];
      const outcome = classifyField(expected, proposed, ticket.ticketText);
      return {
        field,
        expected,
        proposed,
        outcome,
        unconfirmed: proposed === undefined ? undefined : modelProposed(proposed).confirmed === false,
      };
    });

    results.push({
      ticketId: ticket.id,
      language: ticket.language,
      unavailable: extraction.kind === 'unavailable',
      fields,
    });
  }

  const perField = ALL_FIELDS.map((field): FieldMetrics => {
    const outcomes = results.flatMap((r) => r.fields).filter((f) => f.field === field);
    const truePositives = outcomes.filter((f) => f.outcome === 'true_positive').length;
    const falsePositives = outcomes.filter((f) => f.outcome === 'false_positive').length;
    const falseNegatives = outcomes.filter((f) => f.outcome === 'false_negative').length;
    const trueNegatives = outcomes.filter((f) => f.outcome === 'true_negative').length;
    const invented = outcomes.filter((f) => f.outcome === 'invented').length;
    const proposedCount = truePositives + falsePositives + invented;
    const positiveCount = truePositives + falseNegatives;
    return {
      field,
      truePositives,
      falsePositives,
      falseNegatives,
      trueNegatives,
      invented,
      precision: proposedCount === 0 ? undefined : truePositives / proposedCount,
      recall: positiveCount === 0 ? undefined : truePositives / positiveCount,
    };
  });

  const allOutcomes = results.flatMap((r) => r.fields);
  const totalProposed = allOutcomes.filter((f) => f.proposed !== undefined).length;
  const totalInvented = allOutcomes.filter((f) => f.outcome === 'invented').length;

  return {
    ticketCount: tickets.length,
    perField,
    inventedIdentifierRate: totalProposed === 0 ? 0 : totalInvented / totalProposed,
    allProposalsUnconfirmed: allOutcomes.every((f) => f.unconfirmed !== false),
    results,
  };
}

/**
 * The console report both `run-intake-evals.ts` (gating) and
 * `run-intake-evals-live.ts` (non-gating) print — identical formatting,
 * different `LanguageAssistance` behind `runIntakeExtractionEval`, so the
 * report shape lives once here rather than twice.
 */
export function printIntakeEvalReport(report: IntakeEvalReport, label: string): void {
  console.log(`\nIntake extraction eval: ${report.ticketCount} tickets (${label})\n`);
  for (const metrics of report.perField) {
    const precision = metrics.precision === undefined ? 'n/a' : metrics.precision.toFixed(2);
    const recall = metrics.recall === undefined ? 'n/a' : metrics.recall.toFixed(2);
    console.log(
      `  ${metrics.field.padEnd(22)} precision=${precision} recall=${recall} ` +
        `tp=${metrics.truePositives} fp=${metrics.falsePositives} fn=${metrics.falseNegatives} ` +
        `tn=${metrics.trueNegatives} invented=${metrics.invented}`,
    );
  }
  console.log(`\n  invented-identifier rate: ${(report.inventedIdentifierRate * 100).toFixed(1)}%`);
  console.log(`  every proposal unconfirmed: ${report.allProposalsUnconfirmed}`);
  const unavailableCount = report.results.filter((r) => r.unavailable).length;
  if (unavailableCount > 0) {
    console.log(`  Language Assistance reported unavailable for ${unavailableCount}/${report.ticketCount} tickets`);
  }
}
