import { ApiError } from '../../api/ApiError';
import type { AuthenticatedApiRequest } from '../../api/useAuthenticatedApi';
import type { CollectionLinkAddOutcome, MyCollectionLinkSubmissionPage } from './collectionsApi';
import { saveInboxEntry } from '../../inbox/api/inboxApi';
import { unlockHeaders } from './publicCollectionsApi';

/**
 * Adding a link through a writable public link ("모든 사용자: 작성"). Deliberately separate from
 * publicCollectionsApi (the anonymous read API): adding always needs the signed-in user's session
 * - there is no anonymous write. The link is first saved to the user's own library through the
 * normal inbox save (so every URL check applies and it stays theirs), then added to the shared
 * Collection. Its title, URL and automatic preview become visible to everyone with the link; its
 * memo and photos never do.
 */
export async function addLinkToPublicCollection(
  request: AuthenticatedApiRequest,
  publicId: string,
  url: string,
  unlockToken?: string,
): Promise<CollectionLinkAddOutcome> {
  const saved = await saveInboxEntry(request, url);
  // 202: the link takes proposals (승인 후 추가) - it waits for the Owner.
  const response = await request<{ readonly submitted?: boolean }>({
    method: 'PUT',
    path: `/api/v1/public-shares/${encodeURIComponent(publicId)}/items/${saved.id}`,
    headers: unlockHeaders(unlockToken),
  });
  return response?.status === 202 ? 'submitted' : 'added';
}

/**
 * Cancels MY OWN still-waiting proposal made through this public link (a non-member): the same
 * operation as a member's cancel, scoped to the link. 404 for anything that is not mine and waiting here.
 */
export async function cancelMyPublicSubmission(
  request: AuthenticatedApiRequest,
  publicId: string,
  submissionId: number,
): Promise<void> {
  await request<void>({
    method: 'DELETE',
    path: `/api/v1/public-shares/${encodeURIComponent(publicId)}/submissions/mine/${submissionId}`,
  });
}

/**
 * The signed-in viewer's OWN links still waiting for the Owner through this public link (승인 후 추가),
 * newest first, with how many wait in all. A non-member has no Collection id and no Collection API
 * access - this is keyed by the link only, answers about the caller alone (never other submitters,
 * never the Owner's queue) and grants nothing. 404: the link is gone / off; 403 collectionLocked: its
 * share password has not been proven.
 */
export async function getMyPublicSubmissions(
  request: AuthenticatedApiRequest,
  publicId: string,
  cursor?: number | null,
  unlockToken?: string,
): Promise<MyCollectionLinkSubmissionPage> {
  const response = await request<MyCollectionLinkSubmissionPage>({
    method: 'GET',
    path: `/api/v1/public-shares/${encodeURIComponent(publicId)}/submissions/mine${cursor ? `?cursor=${cursor}` : ''}`,
    headers: unlockHeaders(unlockToken),
  });
  if (!response.body) {
    throw new Error('Juple API returned no own-submissions body.');
  }
  return response.body;
}

/** What the signed-in caller is relative to the Collection behind a public link. collectionId / role exist ONLY for a member. */
export interface PublicShareMembership {
  readonly isMember: boolean;
  readonly collectionId: number | null;
  readonly role: 'owner' | 'contributor' | 'submitter' | 'viewer' | null;
  /** Non-members only: whether the Collection's contents are public (false = private link: only a join request is possible). Absent = true. */
  readonly isPublic?: boolean;
  /** Non-members only: MY join request is waiting for the Owner. */
  readonly joinRequestPending?: boolean;
}

export type PublicShareJoinOutcome = 'joined' | 'alreadyMember' | 'requested' | 'alreadyRequested';

export interface PublicShareJoinResult {
  readonly outcome: PublicShareJoinOutcome;
  /** Only when I am a member afterwards. */
  readonly collectionId: number | null;
  readonly role: 'owner' | 'contributor' | 'submitter' | 'viewer' | null;
}

/**
 * Asks the Owner to let ME join - only through a PRIVATE link (공용 컬렉션 OFF); there is no self-join. The caller is the signed-in user
 * (nothing about them is sent). 409 joinNotAllowed for a public link; 403 collectionLocked while a password-protected link has not been
 * unlocked; 404 for an unknown / revoked link.
 */
export async function requestToJoinPublicShare(request: AuthenticatedApiRequest, publicId: string, unlockToken?: string): Promise<PublicShareJoinResult> {
  const response = await request<PublicShareJoinResult>({
    method: 'POST',
    path: `/api/v1/public-shares/${encodeURIComponent(publicId)}/join-requests`,
    headers: unlockHeaders(unlockToken),
  });
  if (!response.body) {
    throw new Error('Juple API returned no join result.');
  }
  return response.body;
}

/**
 * 컬렉션 추가 (저장): explicitly joins the PUBLIC Collection behind this link - always as a Viewer, no approval (the link's Read / Submit /
 * Write permission never decides the role). Opening a link never calls this; only the 저장 button does. 409 joinNotAllowed for a private
 * link (ask to join instead); 403 collectionLocked until a protected link's password is proven; 404 for an unknown / revoked link.
 */
export async function savePublicCollection(request: AuthenticatedApiRequest, publicId: string, unlockToken?: string): Promise<PublicShareJoinResult> {
  const response = await request<PublicShareJoinResult>({
    method: 'POST',
    path: `/api/v1/public-shares/${encodeURIComponent(publicId)}/save`,
    headers: unlockHeaders(unlockToken),
  });
  if (!response.body) {
    throw new Error('Juple API returned no save result.');
  }
  return response.body;
}

/**
 * Is the signed-in caller already the Owner or a member of the Collection this link points to? A member is sent straight to the
 * normal Collection screen (never the public viewer). Returns null for an unknown / revoked link (404); other failures throw.
 */
export async function getPublicShareMembership(
  request: AuthenticatedApiRequest,
  publicId: string,
): Promise<PublicShareMembership | null> {
  try {
    const response = await request<PublicShareMembership>({
      method: 'GET',
      path: `/api/v1/public-shares/${encodeURIComponent(publicId)}/membership`,
    });
    return response.body ?? null;
  } catch (error) {
    if (error instanceof ApiError && error.kind === 'notFound') {
      return null;
    }
    throw error;
  }
}
