import type { AuthenticatedApiRequest } from '../api/useAuthenticatedApi';
import { COLLECTION_UNLOCK_HEADER_NAME, storedUnlockHeaders } from '../collections/collectionUnlockGrants';

/** The longest a comment may be (the server's limit too). */
export const MAX_COMMENT_LENGTH = 1000;
/** How many comments one page asks for. */
export const COMMENT_PAGE_SIZE = 30;
/** How many replies one page of a thread asks for. */
export const REPLY_PAGE_SIZE = 20;

/** Who wrote a comment, as the Collection's own people may see them. */
export interface CommentAuthor {
  readonly jupleId: string;
  readonly displayName: string | null;
  readonly profileImageUrl: string | null;
  readonly profileImageVersion: string | null;
  readonly isCollectionOwner: boolean;
  readonly isMe: boolean;
}

/** Whom a reply answers - named (never an id), and only for a reply to another REPLY. */
export interface CommentReplyTarget {
  readonly jupleId: string;
  readonly displayName: string | null;
}

export interface ItemComment {
  readonly id: number;
  /** Plain text - drawn as text only, never as HTML or markdown. Empty on a deleted placeholder. */
  readonly body: string;
  readonly createdAtUtc: string;
  readonly author: CommentAuthor;
  /**
   * Thread fields - all additive: a server that does not know replies sends none of them, and a comment without them is an
   * ordinary top-level comment with no replies and no hearts.
   * rootCommentId/parentCommentId: set on a reply (the top-level comment it hangs under, and the exact comment it answers).
   */
  readonly rootCommentId?: number | null;
  readonly parentCommentId?: number | null;
  /** The person this reply answers, for a reply to another reply (the "@name" shown in front of it). */
  readonly replyTo?: CommentReplyTarget | null;
  /** On a top-level comment: how many replies its thread has. */
  readonly replyCount?: number;
  readonly likeCount?: number;
  readonly viewerLiked?: boolean;
  /** A deleted comment that others answered: shown as "삭제된 댓글입니다." with its replies kept. */
  readonly isDeleted?: boolean;
}

/** One page of a thread's replies, oldest first; nextCursor is the "after" of the next page (null = this is the last one). */
export interface CommentReplyPage {
  readonly items: readonly ItemComment[];
  readonly nextCursor: number | null;
  readonly totalCount: number;
}

/** A comment's hearts after a like / unlike. */
export interface CommentLikeState {
  readonly liked: boolean;
  readonly likeCount: number;
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

/**
 * Adds the caller's comment; answers it as the server stored it (trimmed). With parentCommentId it is a reply to that comment (or
 * reply): the server alone decides the thread root and whom it answers - only the id of the answered comment is ever sent.
 */
export async function addItemComment(
  request: AuthenticatedApiRequest,
  collectionId: number,
  itemId: number,
  body: string,
  unlockToken?: string | null,
  parentCommentId?: number | null,
): Promise<ItemComment> {
  const response = await request<ItemComment>({
    method: 'POST',
    path: commentsPath(collectionId, itemId),
    body: parentCommentId ? { body, parentCommentId } : { body },
    headers: headers(collectionId, unlockToken),
  });
  if (!response.body) {
    throw new Error('Juple API returned no comment body.');
  }
  return response.body;
}

/** The replies of one thread (a top-level comment), oldest first: the first page, or the one after `after`. */
export async function getCommentReplies(
  request: AuthenticatedApiRequest,
  collectionId: number,
  itemId: number,
  rootCommentId: number,
  options: { readonly after?: number | null; readonly limit?: number; readonly unlockToken?: string | null } = {},
): Promise<CommentReplyPage> {
  const query = [`limit=${options.limit ?? REPLY_PAGE_SIZE}`, ...(options.after ? [`after=${options.after}`] : [])].join('&');
  const response = await request<CommentReplyPage>({
    method: 'GET',
    path: `${commentsPath(collectionId, itemId)}/${rootCommentId}/replies?${query}`,
    headers: headers(collectionId, options.unlockToken),
  });
  if (!response.body) {
    throw new Error('Juple API returned no replies body.');
  }
  return response.body;
}

/** Hearts (liked) or un-hearts a comment for the caller. Idempotent on the server: a repeat answers the same state. */
export async function setCommentLike(
  request: AuthenticatedApiRequest,
  collectionId: number,
  itemId: number,
  commentId: number,
  liked: boolean,
  unlockToken?: string | null,
): Promise<CommentLikeState> {
  const response = await request<CommentLikeState>({
    method: liked ? 'PUT' : 'DELETE',
    path: `${commentsPath(collectionId, itemId)}/${commentId}/like`,
    headers: headers(collectionId, unlockToken),
  });
  if (!response.body) {
    throw new Error('Juple API returned no like body.');
  }
  return response.body;
}

/**
 * Replaces the words of the caller's OWN comment (PUT, like the project's other updates). Only the body can be sent: the server keeps the author, thread,
 * answered person, hearts and time, and tells nobody. Resolves to the comment as stored.
 */
export async function editItemComment(
  request: AuthenticatedApiRequest,
  collectionId: number,
  itemId: number,
  commentId: number,
  body: string,
  unlockToken?: string | null,
): Promise<ItemComment> {
  const response = await request<ItemComment>({
    method: 'PUT',
    path: `${commentsPath(collectionId, itemId)}/${commentId}`,
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
