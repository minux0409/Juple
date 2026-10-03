import type { AuthenticatedApiRequest } from '../../api/useAuthenticatedApi';
import type { CollectionLinkAddOutcome, MyCollectionLinkSubmissionPage } from './collectionsApi';
import { saveInboxEntry } from '../../inbox/api/inboxApi';

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
): Promise<CollectionLinkAddOutcome> {
  const saved = await saveInboxEntry(request, url);
  // 202: the link takes proposals (승인 후 추가) - it waits for the Owner.
  const response = await request<{ readonly submitted?: boolean }>({
    method: 'PUT',
    path: `/api/v1/public-shares/${encodeURIComponent(publicId)}/items/${saved.id}`,
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
): Promise<MyCollectionLinkSubmissionPage> {
  const response = await request<MyCollectionLinkSubmissionPage>({
    method: 'GET',
    path: `/api/v1/public-shares/${encodeURIComponent(publicId)}/submissions/mine${cursor ? `?cursor=${cursor}` : ''}`,
  });
  if (!response.body) {
    throw new Error('Juple API returned no own-submissions body.');
  }
  return response.body;
}
