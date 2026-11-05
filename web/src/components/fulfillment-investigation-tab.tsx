import { useCallback, useEffect, useState } from 'react';
import { RotateCcw, Truck } from 'lucide-react';
import {
  appendReview,
  createInvestigation,
  getInvestigation,
  InvestigationsApiError,
  patchIntake,
  requestExplanationImprovement,
  type AppendReviewInput,
  type FulfillmentIntakeInput,
  type InvestigationResponse,
  type PatchIntakeInput,
} from '../lib/investigations-api-client.ts';
import {
  hashForInvestigation,
  investigationIdFromHash,
} from '../lib/investigation-hash-route.ts';
import { InvestigationDetail } from './investigation-detail.tsx';
import { InvestigationIntakeConfirmation } from './investigation-intake-confirmation.tsx';
import { InvestigationIntakeForm } from './investigation-intake-form.tsx';
import { Alert } from './ui/alert.tsx';
import { Button } from './ui/button.tsx';
import { EmptyState } from './ui/empty-state.tsx';
import { Panel } from './ui/panel.tsx';
import { Skeleton } from './ui/skeleton.tsx';

type FulfillmentState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'error'; message: string; retryId?: string }
  | { kind: 'done'; investigation: InvestigationResponse };

/**
 * Owns the structured Fulfillment Investigation flow end to end: the
 * intake form, `POST /investigations`, and rendering the Current
 * Investigation from `#/investigations/:id` (ADR-0041) — including
 * re-fetching it on a direct load or refresh, not only right after a
 * submit. Kept as one self-contained component rather than threading this
 * state through `App.tsx`.
 */
export function FulfillmentInvestigationTab({
  baseUrl,
  demoKey,
}: {
  baseUrl: string;
  demoKey: string;
}) {
  const [state, setState] = useState<FulfillmentState>({ kind: 'idle' });
  const [isPatching, setIsPatching] = useState(false);
  const [isImprovingExplanation, setIsImprovingExplanation] = useState(false);
  const [explanationError, setExplanationError] = useState<string | null>(null);
  const [isSubmittingReview, setIsSubmittingReview] = useState(false);
  const [reviewError, setReviewError] = useState<string | null>(null);

  const loadFromId = useCallback(
    async (id: string) => {
      setState({ kind: 'loading' });
      try {
        const investigation = await getInvestigation(baseUrl, id, demoKey);
        setState({ kind: 'done', investigation });
      } catch (error) {
        console.error('Failed to load investigation', error);
        setState({
          kind: 'error',
          message: 'Could not load this investigation. It may not exist.',
          retryId: id,
        });
      }
    },
    [baseUrl, demoKey],
  );

  useEffect(() => {
    const initialId = investigationIdFromHash(window.location.hash);
    if (initialId) {
      void loadFromId(initialId);
    }

    function handleHashChange() {
      const id = investigationIdFromHash(window.location.hash);
      if (id) {
        void loadFromId(id);
      }
    }
    window.addEventListener('hashchange', handleHashChange);
    return () => window.removeEventListener('hashchange', handleHashChange);
  }, [loadFromId]);

  async function handleSubmit(input: FulfillmentIntakeInput) {
    setState({ kind: 'loading' });
    try {
      // A fresh key per submit attempt: this is a new create, not a retry
      // of a prior one, so it must never collide with an earlier submit's
      // key (AC5's replay/conflict behavior is for retries of the *same*
      // attempt, e.g. a network retry — see `createInvestigation`'s own doc).
      const investigation = await createInvestigation(
        baseUrl,
        input,
        crypto.randomUUID(),
        demoKey,
      );
      window.location.hash = hashForInvestigation(investigation.id);
      setState({ kind: 'done', investigation });
    } catch (error) {
      console.error('Investigation creation failed', error);
      setState({
        kind: 'error',
        message:
          'Could not reach the investigations service. Check your connection and try again.',
      });
    }
  }

  async function handlePatchIntake(patch: PatchIntakeInput) {
    if (state.kind !== 'done') return;
    setIsPatching(true);
    try {
      // A fresh key per submit attempt, the same rationale as `handleSubmit`
      // above: this is a new intake update, not a retry of a prior one.
      const updated = await patchIntake(
        baseUrl,
        state.investigation.id,
        patch,
        crypto.randomUUID(),
        demoKey,
      );
      setState({ kind: 'done', investigation: updated });
    } catch (error) {
      console.error('Intake update failed', error);
      setState({
        kind: 'error',
        message:
          'Could not update intake. Check your connection and try again.',
      });
    } finally {
      setIsPatching(false);
    }
  }

  async function handleImproveExplanation() {
    if (state.kind !== 'done') return;
    setIsImprovingExplanation(true);
    setExplanationError(null);
    try {
      // A fresh key per click, the same rationale as `handleSubmit` above:
      // this is a new explanation-improvement request, not a retry of a
      // prior one.
      const updated = await requestExplanationImprovement(
        baseUrl,
        state.investigation.id,
        state.investigation.revision,
        crypto.randomUUID(),
        demoKey,
      );
      setState({ kind: 'done', investigation: updated });
    } catch (error) {
      console.error('Explanation improvement failed', error);
      const status =
        error instanceof InvestigationsApiError ? error.status : undefined;
      if (status === 503) {
        // Language Assistance itself was unavailable:
        // nothing was committed, so the deterministic explanation already
        // on screen is unaffected and a retry reuses the same revision.
        setExplanationError(
          'Language Assistance is unavailable right now. The deterministic explanation below is still accurate — try again shortly.',
        );
      } else if (status === 409) {
        // A stale revision or a conflicting-payload idempotency reuse —
        // reload the investigation so the on-screen revision catches up
        // before the next click, instead of retrying against a revision
        // that will keep failing the same way.
        setExplanationError(
          'This investigation changed since it was loaded. Reloading the latest version…',
        );
        void loadFromId(state.investigation.id);
      } else {
        setExplanationError(
          'Could not request an improved explanation. Check your connection and try again.',
        );
      }
    } finally {
      setIsImprovingExplanation(false);
    }
  }

  async function handleSubmitReview(review: AppendReviewInput) {
    if (state.kind !== 'done') return;
    setIsSubmittingReview(true);
    setReviewError(null);
    try {
      // A fresh key per submit attempt, the same rationale as
      // `handleSubmit`/`handlePatchIntake`/`handleImproveExplanation` above:
      // this is a new review, not a retry of a prior one.
      const updated = await appendReview(
        baseUrl,
        state.investigation.id,
        review,
        crypto.randomUUID(),
        demoKey,
      );
      setState({ kind: 'done', investigation: updated });
    } catch (error) {
      console.error('Review submission failed', error);
      const status =
        error instanceof InvestigationsApiError ? error.status : undefined;
      if (status === 409) {
        // A stale revision or a conflicting-payload idempotency reuse —
        // reload the investigation so the on-screen revision catches up
        // before the next submit, instead of retrying against a revision
        // that will keep failing the same way.
        setReviewError(
          'This investigation changed since it was loaded. Reloading the latest version…',
        );
        void loadFromId(state.investigation.id);
      } else {
        setReviewError(
          'Could not submit the review. Check your connection and try again.',
        );
      }
    } finally {
      setIsSubmittingReview(false);
    }
  }

  return (
    <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-[minmax(0,24rem)_minmax(0,1fr)] lg:gap-6">
      <InvestigationIntakeForm
        loading={state.kind === 'loading'}
        onSubmit={handleSubmit}
      />

      {state.kind === 'idle' && (
        <Panel
          aria-label="Investigation result"
          className="bg-transparent shadow-none ring-1 ring-line ring-inset"
        >
          <EmptyState
            icon={<Truck aria-hidden="true" />}
            title="No investigation yet"
            description="Start one from the intake form. The playbook checks inventory, routing and shipping coverage, then the Finding Policy decides."
          />
        </Panel>
      )}

      {state.kind === 'loading' && (
        <Panel
          aria-label="Investigation result"
          aria-busy="true"
          className="max-lg:order-first"
        >
          <div role="status" className="space-y-6 p-5 sm:p-6">
            <span className="sr-only">Running the investigation…</span>
            <div className="flex items-start justify-between gap-4">
              <div className="space-y-2">
                <Skeleton className="h-5 w-48" />
                <Skeleton className="h-4 w-64 max-w-full" />
              </div>
              <Skeleton className="h-6 w-36 rounded-md" />
            </div>
            <div className="space-y-3 border-t border-line pt-5">
              <Skeleton className="h-3 w-16" />
              <Skeleton className="h-6 w-72 max-w-full" />
            </div>
            <div className="space-y-4 border-t border-line pt-5">
              <Skeleton className="h-3 w-28" />
              {[0, 1, 2, 3, 4].map((row) => (
                <div key={row} className="flex gap-3">
                  <Skeleton className="mt-1 size-2.5 shrink-0 rounded-full" />
                  <div className="flex-1 space-y-1.5">
                    <Skeleton className="h-3.5 w-40" />
                    <Skeleton className="h-3.5 w-full" />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </Panel>
      )}

      {state.kind === 'error' && (
        <Panel
          aria-label="Investigation result"
          className="p-5 max-lg:order-first sm:p-6"
        >
          <Alert tone="danger" title="Something went wrong">
            {state.message}
          </Alert>
          {state.retryId && (
            <Button
              variant="secondary"
              size="sm"
              className="mt-4"
              onClick={() => state.retryId && void loadFromId(state.retryId)}
            >
              <RotateCcw aria-hidden="true" />
              Try again
            </Button>
          )}
        </Panel>
      )}

      {state.kind === 'done' && (
        <div className="min-w-0 max-lg:order-first">
          {state.investigation.state === 'awaiting_input' ? (
            <InvestigationIntakeConfirmation
              key={`${state.investigation.id}:${state.investigation.revision}`}
              investigation={state.investigation}
              loading={isPatching}
              onSubmit={handlePatchIntake}
            />
          ) : (
            <InvestigationDetail
              investigation={state.investigation}
              onImproveExplanation={handleImproveExplanation}
              improvingExplanation={isImprovingExplanation}
              explanationError={explanationError}
              onSubmitReview={handleSubmitReview}
              submittingReview={isSubmittingReview}
              reviewError={reviewError}
            />
          )}
        </div>
      )}
    </div>
  );
}
