import type { AuthenticatedApiRequest } from '../../api/useAuthenticatedApi';
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
): Promise<void> {
  const saved = await saveInboxEntry(request, url);
  await request<void>({
    method: 'PUT',
    path: `/api/v1/public-shares/${encodeURIComponent(publicId)}/items/${saved.id}`,
  });
}
