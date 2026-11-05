import type { InvestigationResponse } from '../../../src/api/investigations-app.ts';
import type { FindingCode } from '../../../src/domain/finding-policy.ts';
import type { ReviewReason as DomainReviewReason } from '../../../src/domain/investigation.ts';

// Type-only import from the backend's own domain module: no runtime
// dependency crosses the workspace boundary, so `web/` never needs `zod`
// or a hand-copied second definition of this contract.
export type { InvestigationResponse } from '../../../src/api/investigations-app.ts';

export type FetchLike = (
  url: string,
  init: RequestInit,
) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

interface ErrorResponseBody {
  error?: { message?: string };
}

/**
 * Carries the HTTP status alongside the message so a caller can
 * distinguish *why* a request failed — the explanation-improvement flow
 * specifically needs "Language Assistance is unavailable" (503) to read differently from a
 * stale-revision or conflicting-payload rejection (409), rather than every
 * `requestExplanationImprovement` failure collapsing into one generic
 * message regardless of cause.
 */
export class InvestigationsApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'InvestigationsApiError';
  }
}

/**
 * What the intake form collects: ticket text, explicit
 * structured intake, or both. `accountId` stays required in this form —
 * Account Scope always comes from explicit trusted context, never from
 * `ticketText` (AC2) — while the other structured fields are optional:
 * leaving one blank lets Language Assistance propose it from `ticketText`
 * instead, subject to N2 confirmation via `patchIntake`.
 */
export interface FulfillmentIntakeInput {
  accountId: string;
  ticketText?: string;
  skuId?: string;
  seller?: string;
  quantity?: number;
  destinationPostalCode?: string;
}

// Re-exported under the same name, same type-only-import pattern as
// `InvestigationResponse` above: CONTEXT.md's canonical Review Reason
// has exactly one definition, in the domain module.
export type ReviewReason = DomainReviewReason;

/**
 * `POST /investigations/:id/reviews`'s request body:
 * `confirmed` needs only a declared `reviewerName`; `corrected` also
 * requires a `correctedFindingCode` from the supported taxonomy plus a
 * `reason`; `inconclusive` requires a `reason` — never a
 * `correctedFindingCode`, since an unsupported diagnosis has no taxonomy
 * slot to hold it (`outside_supported_playbook` is the reason for exactly
 * that case). `note` is optional on every outcome.
 */
export type AppendReviewInput =
  | { outcome: 'confirmed'; expectedRevision: number; reviewerName: string; note?: string }
  | {
      outcome: 'corrected';
      expectedRevision: number;
      reviewerName: string;
      correctedFindingCode: FindingCode;
      reason: ReviewReason;
      note?: string;
    }
  | { outcome: 'inconclusive'; expectedRevision: number; reviewerName: string; reason: ReviewReason; note?: string };

/**
 * `PATCH /investigations/:id/intake`'s request body:
 * an explicit field value corrects or completes intake; a field name in
 * `confirm` approves an existing Language Assistance proposal as-is
 * without retyping it. `expectedRevision` is required optimistic
 * concurrency, not optional.
 */
export interface PatchIntakeInput {
  expectedRevision: number;
  accountScope?: { accountId: string };
  skuId?: string;
  seller?: string;
  quantity?: number;
  destinationPostalCode?: string;
  confirm?: Array<'skuId' | 'seller' | 'quantity' | 'destinationPostalCode'>;
}

async function readErrorMessage(response: { json(): Promise<unknown> }, fallback: string): Promise<string> {
  const body = (await response.json().catch(() => undefined)) as ErrorResponseBody | undefined;
  return body?.error?.message ?? fallback;
}

/**
 * `POST /investigations` (AC1): sends confirmed structured intake plus a
 * client-generated `Idempotency-Key`, so a double form submit (a slow
 * network retry, a second click) replays the original Investigation
 * instead of creating a duplicate (AC5). A 409 conflict means the same
 * key was already used for different field values — practically
 * unreachable from this form (a fresh key is minted per submit attempt,
 * see `investigation-intake-form.tsx`), but still surfaced as a real error
 * rather than swallowed.
 */
export async function createInvestigation(
  baseUrl: string,
  intake: FulfillmentIntakeInput,
  idempotencyKey: string,
  demoKey: string,
  fetchImpl: FetchLike = fetch,
): Promise<InvestigationResponse> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Idempotency-Key': idempotencyKey,
  };
  if (demoKey) {
    headers['x-demo-key'] = demoKey;
  }

  const response = await fetchImpl(`${baseUrl}/investigations`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      symptomCode: 'STOCK_WITHOUT_DELIVERY_OPTIONS',
      accountScope: { accountId: intake.accountId },
      ticketText: intake.ticketText || undefined,
      skuId: intake.skuId || undefined,
      seller: intake.seller || undefined,
      quantity: intake.quantity,
      destinationPostalCode: intake.destinationPostalCode || undefined,
    }),
  });

  if (!response.ok) {
    throw new Error(await readErrorMessage(response, `Investigation request failed with status ${response.status}`));
  }
  return (await response.json()) as InvestigationResponse;
}

/** `GET /investigations/:id` (AC2/AC6): the resource URL the hash route re-fetches on load and refresh. */
export async function getInvestigation(
  baseUrl: string,
  id: string,
  demoKey: string,
  fetchImpl: FetchLike = fetch,
): Promise<InvestigationResponse> {
  const headers: Record<string, string> = {};
  if (demoKey) {
    headers['x-demo-key'] = demoKey;
  }

  const response = await fetchImpl(`${baseUrl}/investigations/${encodeURIComponent(id)}`, {
    method: 'GET',
    headers,
  });

  if (!response.ok) {
    throw new Error(await readErrorMessage(response, `Could not load investigation (status ${response.status})`));
  }
  return (await response.json()) as InvestigationResponse;
}

/**
 * `PATCH /investigations/:id/intake`: confirms,
 * completes or corrects intake and, when the merged intake becomes ready,
 * synchronously resumes the same Investigation. Requires an
 * `Idempotency-Key` the same way `createInvestigation` does — a fresh key
 * per submit attempt, not a retry key.
 */
export async function patchIntake(
  baseUrl: string,
  id: string,
  patch: PatchIntakeInput,
  idempotencyKey: string,
  demoKey: string,
  fetchImpl: FetchLike = fetch,
): Promise<InvestigationResponse> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Idempotency-Key': idempotencyKey,
  };
  if (demoKey) {
    headers['x-demo-key'] = demoKey;
  }

  const response = await fetchImpl(`${baseUrl}/investigations/${encodeURIComponent(id)}/intake`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify(patch),
  });

  if (!response.ok) {
    throw new Error(await readErrorMessage(response, `Intake update failed with status ${response.status}`));
  }
  return (await response.json()) as InvestigationResponse;
}

/**
 * `POST /investigations/:id/explanations`: N2's
 * explicit request for a Bedrock-improved explanation of an already
 * `completed` Investigation. Requires an `Idempotency-Key` the same way
 * `createInvestigation`/`patchIntake` do — a fresh key per click, not a
 * retry key — and the current `expectedRevision`. A 503 response means
 * Language Assistance itself was unavailable (not a rejection): the caller
 * keeps showing the deterministic explanation and the same
 * `expectedRevision` still applies to a retry, since this call is never
 * committed to the Investigation Audit Trail when Bedrock fails.
 */
export async function requestExplanationImprovement(
  baseUrl: string,
  id: string,
  expectedRevision: number,
  idempotencyKey: string,
  demoKey: string,
  fetchImpl: FetchLike = fetch,
): Promise<InvestigationResponse> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Idempotency-Key': idempotencyKey,
  };
  if (demoKey) {
    headers['x-demo-key'] = demoKey;
  }

  const response = await fetchImpl(`${baseUrl}/investigations/${encodeURIComponent(id)}/explanations`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ expectedRevision }),
  });

  if (!response.ok) {
    throw new InvestigationsApiError(
      await readErrorMessage(response, `Explanation improvement failed with status ${response.status}`),
      response.status,
    );
  }
  return (await response.json()) as InvestigationResponse;
}

/**
 * `POST /investigations/:id/reviews`: appends a
 * declared, attributed Human Review to an already-`completed`
 * Investigation. Requires an `Idempotency-Key` the same way
 * `createInvestigation`/`patchIntake`/`requestExplanationImprovement` do —
 * a fresh key per submit attempt, not a retry key.
 */
export async function appendReview(
  baseUrl: string,
  id: string,
  review: AppendReviewInput,
  idempotencyKey: string,
  demoKey: string,
  fetchImpl: FetchLike = fetch,
): Promise<InvestigationResponse> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Idempotency-Key': idempotencyKey,
  };
  if (demoKey) {
    headers['x-demo-key'] = demoKey;
  }

  const response = await fetchImpl(`${baseUrl}/investigations/${encodeURIComponent(id)}/reviews`, {
    method: 'POST',
    headers,
    body: JSON.stringify(review),
  });

  if (!response.ok) {
    throw new InvestigationsApiError(
      await readErrorMessage(response, `Review submission failed with status ${response.status}`),
      response.status,
    );
  }
  return (await response.json()) as InvestigationResponse;
}
