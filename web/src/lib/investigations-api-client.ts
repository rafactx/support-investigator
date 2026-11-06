import type { InvestigationResponse } from '../../../src/api/investigations-app.ts';
import type { FindingCode } from '../../../src/domain/finding-policy.ts';
import type { ReviewReason as DomainReviewReason } from '../../../src/domain/investigation.ts';

// Type-only import: no runtime code crosses the workspace boundary.
export type { InvestigationResponse } from '../../../src/api/investigations-app.ts';

export type FetchLike = (
  url: string,
  init: RequestInit,
) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

interface ErrorResponseBody {
  error?: { message?: string };
}

/** Carries the HTTP status so callers can tell a 503 (model unavailable) from a 409. */
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
 * Ticket text, structured intake, or both. `accountId` is always required;
 * a blank field may be proposed from `ticketText` and confirmed later.
 */
export interface FulfillmentIntakeInput {
  accountId: string;
  ticketText?: string;
  skuId?: string;
  seller?: string;
  quantity?: number;
  destinationPostalCode?: string;
}

// Re-exported so Review Reason has one definition, in the domain module.
export type ReviewReason = DomainReviewReason;

/**
 * `corrected` needs a supported `correctedFindingCode` and a `reason`;
 * `inconclusive` needs a `reason`. `note` is optional.
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

/** An explicit value corrects or completes a field; `confirm` approves a proposal as-is. */
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
 * `POST /investigations`. The caller passes a fresh `Idempotency-Key` per
 * submit, so a network retry replays the original Investigation.
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

/** `GET /investigations/:id`: the resource URL the hash route re-fetches on load and refresh. */
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

/** `PATCH /investigations/:id/intake`. Resumes the Investigation when the intake becomes ready. */
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
 * `POST /investigations/:id/explanations`. A 503 means Language Assistance
 * was unavailable; nothing was committed, so a retry at the same
 * `expectedRevision` is valid.
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

/** `POST /investigations/:id/reviews`. Appends a Human Review to a completed Investigation. */
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
