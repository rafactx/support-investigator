import type { ReactNode } from 'react';
import {
  ArrowUpRight,
  CircleCheck,
  CircleDashed,
  CircleX,
  Sparkles,
  UserRound,
} from 'lucide-react';
import type { LedgerFact } from '../../../src/domain/finding-policy.ts';
import type {
  AppendReviewInput,
  InvestigationResponse,
} from '../lib/investigations-api-client.ts';
import { formatTimestamp } from '../lib/format-time.ts';
import { DecisionTag } from './decision-tag.tsx';
import { InvestigationIdLine } from './investigation-id-line.tsx';
import { ProvenanceBadge } from './provenance-badge.tsx';
import { ReviewForm } from './review-form.tsx';
import { Alert } from './ui/alert.tsx';
import { Badge, type BadgeTone } from './ui/badge.tsx';
import { Button } from './ui/button.tsx';
import { Code } from './ui/code.tsx';
import { Panel, PanelHeader, PanelSection } from './ui/panel.tsx';

type Review = InvestigationResponse['reviews'][number];

const REVIEW_OUTCOME_TONE: Record<Review['outcome'], BadgeTone> = {
  confirmed: 'success',
  corrected: 'accent',
  inconclusive: 'warning',
};

const REVIEW_OUTCOME_LABEL: Record<Review['outcome'], string> = {
  confirmed: 'Confirmed',
  corrected: 'Corrected',
  inconclusive: 'Inconclusive',
};

const CONTRACT_RESULT: Record<
  NonNullable<InvestigationResponse['evidence']>['contractResult'],
  { tone: BadgeTone; icon: ReactNode }
> = {
  satisfied: { tone: 'success', icon: <CircleCheck aria-hidden="true" /> },
  insufficient: { tone: 'warning', icon: <CircleDashed aria-hidden="true" /> },
  contradicted: { tone: 'danger', icon: <CircleX aria-hidden="true" /> },
};

/**
 * Reviews carry no server-issued id (the domain model has no need for one
 * beyond append-only position). Every field but `note` together is stable
 * and, in practice, unique per review — far more so than the array index
 * React's own key rule warns against.
 */
function reviewKey(review: Review): string {
  return [
    review.occurredAt,
    review.reviewerName,
    review.outcome,
    review.automatedFindingCode,
    review.outcome === 'corrected' ? review.correctedFindingCode : '',
    review.outcome === 'confirmed' ? '' : review.reason,
  ].join('|');
}

/** A one-line, human-readable rendering of one Ledger Fact — no raw provider field ever reaches this component. */
function describeLedgerFact(fact: LedgerFact): ReactNode {
  switch (fact.kind) {
    case 'inventory':
      return (
        <>
          SKU <Code>{fact.skuId}</Code> (seller <Code>{fact.seller}</Code>):
          requested{' '}
          <span className="tabular-nums">{fact.requestedQuantity}</span>,
          available{' '}
          <span className="tabular-nums">{fact.availableQuantity}</span>.
        </>
      );
    case 'symptom-reproduction':
      return fact.reproduced ? (
        <>
          Simulated checkout to <Code>{fact.destinationPostalCode}</Code>{' '}
          reproduced the symptom: zero deliverable shipping options.
        </>
      ) : (
        <>
          Simulated checkout to <Code>{fact.destinationPostalCode}</Code> did
          not reproduce the symptom.
        </>
      );
    case 'warehouse-to-dock':
      return (
        <>
          Warehouse <Code>{fact.warehouseId}</Code> → dock{' '}
          <Code>{fact.dockId}</Code>: route{' '}
          {fact.routeAvailable ? 'available' : 'unavailable'}.
        </>
      );
    case 'dock-to-policy':
      return (
        <>
          Dock <Code>{fact.dockId}</Code> → shipping policy{' '}
          <Code>{fact.policyId}</Code>: route{' '}
          {fact.routeAvailable ? 'available' : 'unavailable'}.
        </>
      );
    case 'destination-coverage':
      return (
        <>
          Shipping policy <Code>{fact.policyId}</Code> →{' '}
          <Code>{fact.destinationPostalCode}</Code>:{' '}
          {fact.covered ? 'covered' : 'not covered'} by an applicable freight
          rate.
        </>
      );
  }
}

/** Whether a fact is the kind of observation that points at a problem, for the timeline dot. */
function factIsAdverse(fact: LedgerFact): boolean {
  switch (fact.kind) {
    case 'inventory':
      return fact.availableQuantity < fact.requestedQuantity;
    case 'symptom-reproduction':
      return fact.reproduced;
    case 'warehouse-to-dock':
    case 'dock-to-policy':
      return !fact.routeAvailable;
    case 'destination-coverage':
      return !fact.covered;
  }
}

type IntakeFieldShape =
  | { value: string | number; source: 'user' | 'model'; confirmed: boolean }
  | undefined;

function Missing() {
  return <span className="text-fg-subtle italic">missing</span>;
}

/**
 * Renders one intake field's value alongside its provenance ("the UI
 * exposes model provenance"). `undefined` reads as
 * "missing" rather than silently omitting the row, so a still-open gap in
 * an `awaiting_input` Investigation is visible here too, not only in
 * `InvestigationIntakeConfirmation`'s own gap list.
 */
function IntakeRow({
  label,
  field,
  children,
}: {
  label: string;
  field?: IntakeFieldShape;
  children?: ReactNode;
}) {
  return (
    <div className="grid grid-cols-1 gap-1 py-2.5 sm:grid-cols-[11rem_minmax(0,1fr)] sm:items-center sm:gap-4">
      <dt className="text-caption text-fg-muted">{label}</dt>
      <dd className="flex min-w-0 flex-wrap items-center gap-2">
        {children ??
          (field ? (
            <>
              <span className="font-mono text-sm tabular-nums [overflow-wrap:anywhere]">
                {field.value}
              </span>
              <ProvenanceBadge
                source={field.source}
                confirmed={field.confirmed}
              />
            </>
          ) : (
            <Missing />
          ))}
      </dd>
    </div>
  );
}

function SourceList({
  sources,
}: {
  sources: readonly { url: string; title: string }[];
}) {
  if (sources.length === 0) return null;
  return (
    <ul className="mt-3 flex flex-col gap-1.5">
      {sources.map((source) => (
        <li key={source.url}>
          <a
            href={source.url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-start gap-1 text-sm text-accent underline decoration-accent/30 underline-offset-[3px] transition-[text-decoration-color] duration-200 hover:decoration-accent [overflow-wrap:anywhere]"
          >
            {source.title}
            <ArrowUpRight
              aria-hidden="true"
              className="mt-0.5 size-3.5 shrink-0"
            />
            <span className="sr-only">(opens in a new tab)</span>
          </a>
        </li>
      ))}
    </ul>
  );
}

/** One entry in the append-only Human Review history — every prior review renders exactly as recorded, never rewritten by a later one. */
function ReviewHistoryItem({ review }: { review: Review }) {
  return (
    <li className="group relative pb-5 pl-7 last:pb-0">
      <span
        aria-hidden="true"
        className="absolute top-5 bottom-0 left-[7px] w-px bg-line group-last:hidden"
      />
      <span
        aria-hidden="true"
        className="absolute top-0.5 left-0 grid size-[15px] place-items-center rounded-full bg-surface ring-1 ring-line-strong"
      >
        <UserRound className="size-2.5 text-fg-muted" />
      </span>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="text-sm font-medium">{review.reviewerName}</span>
        <Badge tone={REVIEW_OUTCOME_TONE[review.outcome]}>
          {REVIEW_OUTCOME_LABEL[review.outcome]}
        </Badge>
        <time
          dateTime={review.occurredAt}
          className="text-caption text-fg-subtle tabular-nums"
        >
          {formatTimestamp(review.occurredAt)}
        </time>
      </div>
      <div className="mt-1.5 space-y-1 text-sm text-fg-muted">
        {review.outcome === 'corrected' && (
          <p>
            Corrected to <Code>{review.correctedFindingCode}</Code> from the
            automated <Code>{review.automatedFindingCode}</Code>.
          </p>
        )}
        {review.outcome !== 'confirmed' && (
          <p>
            Reason <Code>{review.reason}</Code>
          </p>
        )}
        {review.note && <p className="text-fg">{review.note}</p>}
        <p className="text-xs text-fg-subtle">
          Declared attribution, not an authenticated identity.
        </p>
      </div>
    </li>
  );
}

/**
 * A Current Investigation: intake provenance, Ledger Facts, the Evidence
 * Contract Result, the Finding, the Investigation Decision and the
 * deterministic explanation. A capability failure gets its own callout so an
 * empty ledger does not read as "nothing happened".
 *
 * `onImproveExplanation` and `onSubmitReview` are offered only for a
 * completed Investigation. An improved explanation is shown below the
 * deterministic one, never in its place, and a review never changes
 * `finding.code`.
 */
export function InvestigationDetail({
  investigation,
  onImproveExplanation,
  improvingExplanation = false,
  explanationError = null,
  onSubmitReview,
  submittingReview = false,
  reviewError = null,
}: {
  investigation: InvestigationResponse;
  onImproveExplanation?: () => void;
  improvingExplanation?: boolean;
  explanationError?: string | null;
  onSubmitReview?: (review: AppendReviewInput) => void;
  submittingReview?: boolean;
  reviewError?: string | null;
}) {
  const {
    evidence,
    finding,
    decision,
    explanation,
    explanationImprovement,
    reviews,
    reviewedFinding,
  } = investigation;

  return (
    <Panel aria-labelledby="detail-title">
      <PanelHeader
        titleId="detail-title"
        title="Fulfillment investigation"
        description={
          <InvestigationIdLine
            id={investigation.id}
            createdAt={investigation.createdAt}
          />
        }
        actions={decision && <DecisionTag decision={decision.outcome} />}
      />
      <p className="px-5 pt-2 pb-5 text-caption text-fg-subtle sm:px-6">
        An Investigation Decision is a recommendation for the next step. It
        never changes the support ticket’s own status.
      </p>

      {(investigation.state === 'awaiting_input' ||
        investigation.state === 'failed') && (
        <div className="px-5 pb-5 sm:px-6">
          {investigation.state === 'awaiting_input' ? (
            <Alert tone="warning" title="Waiting on intake">
              The Fulfillment Playbook can’t run until intake is complete. No
              operational capability has been called yet.
            </Alert>
          ) : (
            <Alert tone="danger" title="Investigation failed">
              A technical failure stopped the investigation, so no Finding was
              established.
              {investigation.failureReason && (
                <>
                  {' '}
                  <Code>{investigation.failureReason}</Code>
                </>
              )}
            </Alert>
          )}
        </div>
      )}

      {finding && decision && (
        <PanelSection
          title="Finding"
          aside={
            reviewedFinding ? (
              <Badge
                tone={
                  reviewedFinding.outcome === 'corrected' ? 'accent' : 'success'
                }
              >
                <CircleCheck aria-hidden="true" />
                Reviewed
              </Badge>
            ) : reviews.length > 0 ? (
              // CONTEXT.md's Unreviewed Signal is a finding a human has "not
              // yet confirmed, corrected or marked inconclusive" — once the
              // latest review is inconclusive, it no longer fits that
              // definition, even though it's still ineligible for the CX
              // Intelligence Loop.
              <Badge tone="warning">
                <CircleDashed aria-hidden="true" />
                Inconclusive review
              </Badge>
            ) : (
              <Badge tone="neutral">
                <CircleDashed aria-hidden="true" />
                Unreviewed signal
              </Badge>
            )
          }
        >
          <p className="font-mono text-lg font-medium tracking-tight [overflow-wrap:anywhere]">
            {finding.code}
          </p>
          <dl className="mt-2 flex flex-wrap gap-x-5 gap-y-1.5 text-caption text-fg-muted">
            <div className="flex items-center gap-1.5">
              <dt>Decision reason</dt>
              <dd>
                <Code>{decision.reason}</Code>
              </dd>
            </div>
            <div className="flex items-center gap-1.5">
              <dt>Policy</dt>
              <dd>
                <Code>{finding.policyVersion}</Code>
              </dd>
            </div>
          </dl>
          <p className="mt-3 text-caption text-fg-subtle">
            {reviewedFinding ? (
              <>
                Reviewed Finding <Code>{reviewedFinding.code}</Code> is eligible
                for the CX Intelligence Loop.
              </>
            ) : reviews.length > 0 ? (
              'The latest review is inconclusive, so this Finding is not eligible for the CX Intelligence Loop.'
            ) : (
              'Not yet eligible for the CX Intelligence Loop. A human review below makes it eligible.'
            )}
          </p>
        </PanelSection>
      )}

      {evidence && (
        <PanelSection
          title="Evidence ledger"
          aside={
            <Badge tone={CONTRACT_RESULT[evidence.contractResult].tone}>
              {CONTRACT_RESULT[evidence.contractResult].icon}
              Contract {evidence.contractResult}
            </Badge>
          }
        >
          {evidence.capabilityFailure && (
            <Alert
              tone="warning"
              title="A capability check couldn’t complete"
              className="mb-4"
            >
              <Code>{evidence.capabilityFailure.capability}</Code> failed:{' '}
              {evidence.capabilityFailure.message} That is why the ledger below
              is incomplete.
            </Alert>
          )}
          {evidence.ledgerFacts.length === 0 ? (
            <p className="text-sm text-fg-subtle">
              No ledger facts were gathered.
            </p>
          ) : (
            <ol className="flex flex-col">
              {evidence.ledgerFacts.map((fact) => {
                const adverse = factIsAdverse(fact);
                return (
                  <li
                    key={fact.capabilityCallId}
                    className="group relative pb-4 pl-7 last:pb-0"
                  >
                    <span
                      aria-hidden="true"
                      className="absolute top-3 bottom-0 left-[7px] w-px bg-line group-last:hidden"
                    />
                    <span
                      aria-hidden="true"
                      className={`absolute top-1 left-[3px] size-[9px] rounded-full ring-4 ring-surface ${adverse ? 'bg-warning' : 'bg-success'}`}
                    />
                    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                      <span className="font-mono text-caption font-medium text-fg">
                        {fact.kind}
                      </span>
                      <span className="font-mono text-xs text-fg-subtle tabular-nums [overflow-wrap:anywhere]">
                        {fact.capabilityCallId}
                      </span>
                    </div>
                    <p className="mt-0.5 text-sm leading-relaxed text-fg-muted">
                      <span className="sr-only">
                        {adverse ? 'Adverse: ' : 'Normal: '}
                      </span>
                      {describeLedgerFact(fact)}
                    </p>
                  </li>
                );
              })}
            </ol>
          )}
        </PanelSection>
      )}

      {explanation && (
        <PanelSection
          title="Explanation"
          aside={
            <span className="text-xs text-fg-subtle">Finding Source Pack</span>
          }
        >
          <p className="max-w-[68ch] text-sm leading-relaxed">
            {explanation.summary}
          </p>
          <SourceList sources={explanation.sources} />

          {investigation.state === 'completed' && onImproveExplanation && (
            <div className="mt-5 flex flex-col items-start gap-3">
              <Button
                variant="secondary"
                size="sm"
                loading={improvingExplanation}
                onClick={onImproveExplanation}
              >
                {!improvingExplanation && <Sparkles aria-hidden="true" />}
                {improvingExplanation
                  ? 'Asking the model…'
                  : 'Improve explanation with the model'}
              </Button>

              {explanationError && (
                <Alert tone="warning" className="w-full">
                  {explanationError}
                </Alert>
              )}

              {explanationImprovement?.status === 'rejected' && (
                <Alert
                  tone="warning"
                  title="Improved explanation rejected"
                  className="w-full"
                >
                  The model’s draft referenced something outside the confirmed
                  evidence: {explanationImprovement.reason} The deterministic
                  explanation above remains the one to rely on.
                </Alert>
              )}

              {explanationImprovement?.status === 'accepted' && (
                <div className="w-full rounded-lg bg-subtle p-4 ring-1 ring-line ring-inset">
                  <Badge tone="accent">
                    <Sparkles aria-hidden="true" />
                    Model-improved · on request
                  </Badge>
                  <p className="mt-2.5 max-w-[68ch] text-sm leading-relaxed">
                    {explanationImprovement.improvedExplanation.summary}
                  </p>
                  <SourceList
                    sources={explanationImprovement.improvedExplanation.sources}
                  />
                </div>
              )}
            </div>
          )}
        </PanelSection>
      )}

      <PanelSection title="Intake">
        <dl className="-my-2.5 divide-y divide-line">
          <IntakeRow label="Merchant account">
            {investigation.intake.accountScope ? (
              <span className="font-mono text-sm">
                {investigation.intake.accountScope.value.accountId}
              </span>
            ) : (
              <Missing />
            )}
          </IntakeRow>
          <IntakeRow label="SKU" field={investigation.intake.skuId} />
          <IntakeRow label="Seller" field={investigation.intake.seller} />
          <IntakeRow label="Quantity" field={investigation.intake.quantity} />
          <IntakeRow
            label="Destination postal code"
            field={investigation.intake.destinationPostalCode}
          />
        </dl>
      </PanelSection>

      {investigation.state === 'completed' && (
        <PanelSection
          title="Human review"
          aside={
            reviews.length > 0 && (
              <span className="text-xs text-fg-subtle tabular-nums">
                {reviews.length} {reviews.length === 1 ? 'review' : 'reviews'}
              </span>
            )
          }
        >
          {reviews.length > 0 && (
            <ol className="mb-6 flex flex-col">
              {reviews.map((review) => (
                <ReviewHistoryItem key={reviewKey(review)} review={review} />
              ))}
            </ol>
          )}

          {reviewError && (
            <Alert tone="warning" className="mb-4">
              {reviewError}
            </Alert>
          )}

          {onSubmitReview && (
            <ReviewForm
              investigation={investigation}
              loading={submittingReview}
              onSubmit={onSubmitReview}
            />
          )}
        </PanelSection>
      )}
    </Panel>
  );
}
