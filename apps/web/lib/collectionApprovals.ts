import { ApiHttpError, type AppApi } from './appApi.ts';
import { unlockHeaders } from './collectionUnlock.ts';
import type { CollectionSummary } from './collectionsView.ts';

/**
 * The Owner's received requests in a shared Collection - the Web side of mobile's ApprovalSubmissionSheet and JoinRequestsSheet, on the
 * same endpoints and rules: a proposed link (승인 후 추가) is approved into the Collection or rejected; a person waiting to join is
 * approved (always a Viewer) or declined. Only the Owner is offered either; the server checks it again on every call.
 */

export interface LinkSubmission {
  readonly submissionId: number;
  readonly url: string;
  readonly title: string | null;
  readonly previewImageUrl: string | null;
  readonly submittedAtUtc: string;
  /** Proposed through the public link by a non-member - never named. */
  readonly viaPublicShare: boolean;
  readonly proposer: { readonly kind?: string; readonly jupleId?: string | null; readonly displayName?: string | null; readonly profileImageUrl?: string | null } | null;
}

export interface JoinRequest {
  readonly requestId: number;
  readonly jupleId: string;
  readonly displayName: string | null;
  readonly profileImageUrl: string | null;
  readonly requestedAtUtc: string;
}

interface Page<T> {
  readonly items: readonly T[];
  readonly nextCursor: number | null;
}

/** Every page is read so the number on the badge and the list agree (bounded: a runaway cursor never loops). */
async function readAll<T>(api: AppApi, collectionId: number, resource: 'submissions' | 'join-requests'): Promise<readonly T[]> {
  const all: T[] = [];
  let cursor: number | null = null;
  const seen = new Set<number>();
  for (let page = 0; page < 20; page += 1) {
    const path: string = `/api/v1/collections/${collectionId}/${resource}${cursor ? `?cursor=${cursor}` : ''}`;
    const body: Page<T> = await api<Page<T>>({ path, headers: unlockHeaders(collectionId) });
    all.push(...body.items);
    if (body.nextCursor === null || seen.has(body.nextCursor)) {
      break;
    }
    seen.add(body.nextCursor);
    cursor = body.nextCursor;
  }
  return all;
}

export const loadLinkSubmissions = (api: AppApi, collectionId: number) => readAll<LinkSubmission>(api, collectionId, 'submissions');
export const loadJoinRequests = (api: AppApi, collectionId: number) => readAll<JoinRequest>(api, collectionId, 'join-requests');

export type AnswerOutcome = 'done' | 'gone';

/** 404 = no longer waiting (answered elsewhere); 409 = can no longer be added. Both mean "nothing left to answer here". */
function outcomeOf(error: unknown): AnswerOutcome | null {
  return error instanceof ApiHttpError && (error.status === 404 || error.status === 409) ? 'gone' : null;
}

export async function answerLinkSubmission(api: AppApi, collectionId: number, submissionId: number, approve: boolean): Promise<AnswerOutcome> {
  const base = `/api/v1/collections/${collectionId}/submissions/${submissionId}`;
  try {
    await api<void>(approve ? { method: 'POST', path: `${base}/approve`, headers: unlockHeaders(collectionId) } : { method: 'DELETE', path: base, headers: unlockHeaders(collectionId) });
    return 'done';
  } catch (error) {
    const outcome = outcomeOf(error);
    if (outcome) return outcome;
    throw error;
  }
}

export async function answerJoinRequest(api: AppApi, collectionId: number, requestId: number, approve: boolean): Promise<AnswerOutcome> {
  try {
    await api<void>({ method: 'POST', path: `/api/v1/collections/${collectionId}/join-requests/${requestId}/${approve ? 'approve' : 'reject'}`, headers: unlockHeaders(collectionId) });
    return 'done';
  } catch (error) {
    const outcome = outcomeOf(error);
    if (outcome) return outcome;
    throw error;
  }
}

/** The Collections this person answers as Owner, with how many requests (links + join requests) wait in each. */
export function ownerRequestCollections(collections: readonly CollectionSummary[] | null | undefined): readonly (CollectionSummary & { readonly requestCount: number })[] {
  return (collections ?? []).flatMap(collection => {
    const requestCount = (collection.pendingSubmissionCount ?? 0) + (collection.pendingJoinRequestCount ?? 0);
    return (collection.accessRole ?? 'owner') === 'owner' && requestCount > 0 ? [{ ...collection, requestCount }] : [];
  });
}

/** `?requests=1` opens the answering dialog: the Owner's notification for a proposed link / a join request lands here. */
export const REQUESTS_PARAM = 'requests';

/** One of MY OWN proposals still waiting for an Owner (mobile MyCollectionLinkSubmissionWithCollection). Never anyone else's. */
export interface MySubmission {
  readonly submissionId: number;
  readonly url: string;
  readonly title: string | null;
  readonly previewImageUrl: string | null;
  readonly submittedAtUtc: string;
  /** Null for a request of mine in a Collection I am not a member of (a public-link request): no Collection data is sent. */
  readonly collectionId: number | null;
  readonly collectionName: string | null;
}

export const MY_PENDING_COUNT_PATH = '/api/v1/collections/my-pending-submissions/count';

export async function loadMyPendingCount(api: AppApi): Promise<number> {
  const body = await api<{ readonly myPendingSubmissionCount?: number } | undefined>({ path: MY_PENDING_COUNT_PATH });
  return Math.max(0, Math.floor(body?.myPendingSubmissionCount ?? 0));
}

export async function loadMySubmissions(api: AppApi): Promise<readonly MySubmission[]> {
  const all: MySubmission[] = [];
  let cursor: number | null = null;
  const seen = new Set<number>();
  for (let page = 0; page < 20; page += 1) {
    const body: { readonly items: readonly MySubmission[]; readonly nextCursor: number | null } = await api({ path: `/api/v1/collections/submissions/mine${cursor ? `?cursor=${cursor}` : ''}` });
    all.push(...body.items);
    if (body.nextCursor === null || seen.has(body.nextCursor)) break;
    seen.add(body.nextCursor);
    cursor = body.nextCursor;
  }
  return all;
}

/** Withdraws my own waiting proposal. 404 = it is already answered or withdrawn: nothing is left to cancel. */
export async function cancelMySubmission(api: AppApi, submissionId: number): Promise<AnswerOutcome> {
  try {
    await api<void>({ method: 'DELETE', path: `/api/v1/collections/submissions/mine/${submissionId}` });
    return 'done';
  } catch (error) {
    const outcome = outcomeOf(error);
    if (outcome) return outcome;
    throw error;
  }
}
