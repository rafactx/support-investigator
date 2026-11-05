import { type FormEvent, useState } from 'react';
import type { FindingCode } from '../../../src/domain/finding-policy.ts';
import type {
  AppendReviewInput,
  InvestigationResponse,
  ReviewReason,
} from '../lib/investigations-api-client.ts';
import { cn } from '../lib/cn.ts';
import { Button } from './ui/button.tsx';
import {
  Field,
  FieldDescription,
  Input,
  Label,
  Optional,
  Select,
  Textarea,
} from './ui/field.tsx';

type ReviewOutcomeOption = 'confirmed' | 'corrected' | 'inconclusive';

// Type-only-checked against the backend's own taxonomy (`FindingCode`),
// the same pattern `investigations-api-client.ts` already establishes for
// crossing the `web/`↔`src/` boundary without a runtime dependency — this
// list must still be declared here because `FindingCode` erases at compile
// time and a `<select>` needs the actual string values to render.
const SUPPORTED_FINDING_CODES = [
  'DESTINATION_NOT_COVERED',
  'ROOT_CAUSE_UNDETERMINED',
] as const satisfies readonly FindingCode[];

const REVIEW_REASON_LABELS: Record<ReviewReason, string> = {
  missing_evidence: 'Missing evidence',
  blocked_access: 'Blocked access',
  conflicting_evidence: 'Conflicting evidence',
  outside_supported_playbook: 'Outside supported playbook',
};
const REVIEW_REASONS = Object.keys(REVIEW_REASON_LABELS) as ReviewReason[];

const OUTCOME_OPTIONS: readonly {
  value: ReviewOutcomeOption;
  label: string;
  hint: string;
}[] = [
  {
    value: 'confirmed',
    label: 'Confirm',
    hint: 'The automated Finding is right.',
  },
  {
    value: 'corrected',
    label: 'Correct',
    hint: 'A different supported Finding fits.',
  },
  {
    value: 'inconclusive',
    label: 'Inconclusive',
    hint: 'The evidence can’t settle it.',
  },
];

/**
 * `POST /investigations/:id/reviews`'s form:
 * confirms, corrects within the supported taxonomy, or records an
 * inconclusive result with a canonical Review Reason and optional note.
 * `correctedFindingCode` only appears for `corrected` (restricted to the
 * two supported codes — the server enforces this too, but offering only
 * those options here means the reviewer never has to discover the
 * taxonomy limit from a 400); `reason` appears for both `corrected` and
 * `inconclusive`, never for `confirmed`. Never asks for a login or claims
 * this changes the support ticket's status — `reviewerName` is declared
 * demo attribution only (CONTEXT.md's Human Review: "a short reviewer
 * name is declared and stored as attribution, not as authenticated
 * identity").
 */
export function ReviewForm({
  investigation,
  loading,
  onSubmit,
}: {
  investigation: InvestigationResponse;
  loading: boolean;
  onSubmit: (review: AppendReviewInput) => void;
}) {
  const automatedCode = investigation.finding?.code;
  const [outcome, setOutcome] = useState<ReviewOutcomeOption>('confirmed');
  const [reviewerName, setReviewerName] = useState('');
  const [correctedFindingCode, setCorrectedFindingCode] = useState<FindingCode>(
    SUPPORTED_FINDING_CODES.find((code) => code !== automatedCode) ??
      SUPPORTED_FINDING_CODES[0],
  );
  const [reason, setReason] = useState<ReviewReason>('conflicting_evidence');
  const [note, setNote] = useState('');

  const canSubmit = reviewerName.trim() !== '';

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSubmit) return;

    const trimmedNote = note.trim() || undefined;
    const base = {
      expectedRevision: investigation.revision,
      reviewerName: reviewerName.trim(),
    };

    if (outcome === 'confirmed') {
      onSubmit({ outcome: 'confirmed', ...base, note: trimmedNote });
    } else if (outcome === 'corrected') {
      onSubmit({
        outcome: 'corrected',
        ...base,
        correctedFindingCode,
        reason,
        note: trimmedNote,
      });
    } else {
      onSubmit({ outcome: 'inconclusive', ...base, reason, note: trimmedNote });
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="flex flex-col gap-5"
      aria-labelledby="review-form-title"
    >
      <div>
        <h4 id="review-form-title" className="text-sm font-medium">
          Add a review
        </h4>
        <p className="mt-0.5 text-caption text-fg-subtle">
          Reviews are append-only and never change the support ticket’s own
          status.
        </p>
      </div>

      <fieldset className="flex flex-col gap-1.5">
        <legend className="mb-1.5 text-caption font-medium">Outcome</legend>
        <div className="grid grid-cols-1 gap-2 min-[480px]:grid-cols-3">
          {OUTCOME_OPTIONS.map((option) => {
            const checked = outcome === option.value;
            return (
              <label
                key={option.value}
                className={cn(
                  'relative flex cursor-pointer flex-col gap-0.5 rounded-lg px-3 py-2.5 transition-[box-shadow,background-color] duration-150',
                  'has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-accent',
                  checked
                    ? 'bg-surface shadow-[0_0_0_1.5px_var(--si-fg)]'
                    : 'bg-surface shadow-card hover:bg-subtle',
                )}
              >
                <input
                  type="radio"
                  name="rv-outcome"
                  value={option.value}
                  checked={checked}
                  onChange={() => setOutcome(option.value)}
                  className="sr-only"
                />
                <span className="text-sm font-medium">{option.label}</span>
                <span className="text-xs text-fg-subtle">{option.hint}</span>
              </label>
            );
          })}
        </div>
      </fieldset>

      {(outcome === 'corrected' || outcome === 'inconclusive') && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {outcome === 'corrected' && (
            <Field>
              <Label htmlFor="rv-corrected-code">Corrected Finding</Label>
              <Select
                id="rv-corrected-code"
                value={correctedFindingCode}
                onChange={(event) =>
                  setCorrectedFindingCode(event.target.value as FindingCode)
                }
                aria-describedby="rv-corrected-code-description"
                className="font-mono text-caption sm:text-caption"
              >
                {SUPPORTED_FINDING_CODES.map((code) => (
                  <option key={code} value={code}>
                    {code}
                  </option>
                ))}
              </Select>
              <FieldDescription id="rv-corrected-code-description">
                A cause outside this taxonomy has no slot here. Record it as
                inconclusive with “Outside supported playbook” instead.
              </FieldDescription>
            </Field>
          )}

          <Field>
            <Label htmlFor="rv-reason">Review reason</Label>
            <Select
              id="rv-reason"
              value={reason}
              onChange={(event) =>
                setReason(event.target.value as ReviewReason)
              }
            >
              {REVIEW_REASONS.map((value) => (
                <option key={value} value={value}>
                  {REVIEW_REASON_LABELS[value]}
                </option>
              ))}
            </Select>
          </Field>
        </div>
      )}

      <Field>
        <Label htmlFor="rv-reviewer-name">Reviewer name</Label>
        <Input
          id="rv-reviewer-name"
          value={reviewerName}
          onChange={(event) => setReviewerName(event.target.value)}
          placeholder="Short name or handle"
          maxLength={80}
          autoComplete="nickname"
          required
          aria-describedby="rv-reviewer-name-description"
        />
        <FieldDescription id="rv-reviewer-name-description">
          Declared attribution for this demo, not an authenticated identity.
        </FieldDescription>
      </Field>

      <Field>
        <Label htmlFor="rv-note">
          Note
          <Optional />
        </Label>
        <Textarea
          id="rv-note"
          value={note}
          onChange={(event) => setNote(event.target.value)}
          rows={3}
          placeholder="Context for the next person. The canonical reason above still applies."
        />
      </Field>

      <Button
        type="submit"
        variant="primary"
        loading={loading}
        disabled={!canSubmit}
        className="self-start"
      >
        {loading ? 'Saving review…' : 'Submit review'}
      </Button>
    </form>
  );
}
