import type { AuthenticatedApiRequest } from '../api/useAuthenticatedApi';
import { COLLECTION_UNLOCK_HEADER_NAME, storedUnlockHeaders } from '../collections/collectionUnlockGrants';

/** The longest a comment may be (the server's limit too). */
export const MAX_COMMENT_LENGTH = 1000;
/** How many comments one page asks for. */
export const COMMENT_PAGE_SIZE = 30;

/** Who wrote a comment, as the Collection's own people may see them. */
export interface CommentAuthor {
  readonly jupleId: string;
  readonly displayName: string | null;
  readonly profileImageUrl: string | null;
  readonly profileImageVersion: string | null;
  readonly isCollectionOwner: boolean;
  readonly isMe: boolean;
}

export interface ItemComment {
  readonly id: number;
  /** Plain text - drawn as text only, never as HTML or markdown. */
  readonly body: string;
  readonly createdAtUtc: string;
  readonly author: CommentAuthor;
}

/** One page, oldest first; previousCursor is the "before" of the next older page (null = this one starts at the oldest). */
export interface ItemCommentPage {
  readonly items: readonly ItemComment[];
  readonly previousCursor: number | null;
  readonly totalCount: number;
}

function headers(collectionId: number, unlockToken?: string | null) {
  return unlockToken ? { [COLLECTION_UNLOCK_HEADER_NAME]: unlockToken } : storedUnlockHeaders(collectionId);
}

const commentsPath = (collectionId: number, itemId: number) => `/api/v1/collections/${collectionId}/items/${itemId}/comments`;

/** The newest comments of a link (or, with `before`, the page before it). Owner and accepted members only. */
export async function getItemComments(
  request: AuthenticatedApiRequest,
  collectionId: number,
  itemId: number,
  options: { readonly before?: number | null; readonly limit?: number; readonly unlockToken?: string | null } = {},
): Promise<ItemCommentPage> {
  const query = [`limit=${options.limit ?? COMMENT_PAGE_SIZE}`, ...(options.before ? [`before=${options.before}`] : [])].join('&');
  const response = await request<ItemCommentPage>({
    method: 'GET',
    path: `${commentsPath(collectionId, itemId)}?${query}`,
    headers: headers(collectionId, options.unlockToken),
  });
  if (!response.body) {
    throw new Error('Juple API returned no comments body.');
  }
  return response.body;
}

/** Adds the caller's comment; answers it as the server stored it (trimmed). */
export async function addItemComment(
  request: AuthenticatedApiRequest,
  collectionId: number,
  itemId: number,
  body: string,
  unlockToken?: string | null,
): Promise<ItemComment> {
  const response = await request<ItemComment>({
    method: 'POST',
    path: commentsPath(collectionId, itemId),
    body: { body },
    headers: headers(collectionId, unlockToken),
  });
  if (!response.body) {
    throw new Error('Juple API returned no comment body.');
  }
  return response.body;
}

/** Deletes a comment (its author, or the Collection's Owner); one that is gone already is a success. */
export async function deleteItemComment(
  request: AuthenticatedApiRequest,
  collectionId: number,
  itemId: number,
  commentId: number,
  unlockToken?: string | null,
): Promise<void> {
  await request<void>({
    method: 'DELETE',
    path: `${commentsPath(collectionId, itemId)}/${commentId}`,
    headers: headers(collectionId, unlockToken),
  });
}
