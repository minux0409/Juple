import { useCallback, useEffect, useRef, useState } from 'react';
import type { AuthenticatedApiRequest } from '../api/useAuthenticatedApi';
import { addItemComment, COMMENT_PAGE_SIZE, deleteItemComment, getItemComments, type ItemComment } from './commentsApi';

export type CommentsStatus = 'loading' | 'ready' | 'error';

/**
 * The conversation of ONE link: the newest page when the screen opens, older pages on request
 * (prepended, never duplicated), a comment added or deleted by changing only this list - the link's
 * own screen state, reactions and everything else are never reloaded for it.
 *
 * - send(body): one request at a time (a second tap while it is on its way is ignored); on success the
 *   server's own comment is appended and the count goes up; on failure nothing changes, `false` is
 *   returned (the composer keeps its text) and onFailure('send') reports it.
 * - remove(id): the row leaves at once and the count goes down; a failure puts it back in its place.
 * - loadPrevious(): the page before the oldest loaded one.
 */
export function useItemComments(
  authenticatedRequest: AuthenticatedApiRequest,
  collectionId: number,
  itemId: number,
  getUnlockToken: () => string | null,
  onFailure: (kind: 'send' | 'delete' | 'older') => void,
  /** Off: nothing is requested (the link is not in a collaborative Collection here). */
  enabled = true,
) {
  const [comments, setComments] = useState<readonly ItemComment[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [previousCursor, setPreviousCursor] = useState<number | null>(null);
  const [status, setStatus] = useState<CommentsStatus>('loading');
  const [isLoadingPrevious, setIsLoadingPrevious] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const commentsRef = useRef<readonly ItemComment[]>([]);
  commentsRef.current = comments;
  const isSendingRef = useRef(false);
  const isLoadingPreviousRef = useRef(false);
  const pendingDeletesRef = useRef(new Set<number>());
  const failureRef = useRef(onFailure);
  failureRef.current = onFailure;
  const tokenRef = useRef(getUnlockToken);
  tokenRef.current = getUnlockToken;

  const load = useCallback(async () => {
    setStatus('loading');
    try {
      const page = await getItemComments(authenticatedRequest, collectionId, itemId, { unlockToken: tokenRef.current() });
      setComments(page.items);
      setTotalCount(page.totalCount);
      setPreviousCursor(page.previousCursor);
      setStatus('ready');
    } catch {
      setStatus('error');
    }
  }, [authenticatedRequest, collectionId, itemId]);

  useEffect(() => {
    if (enabled) {
      load().catch(() => undefined);
    }
  }, [enabled, load]);

  const loadPrevious = useCallback(async () => {
    if (previousCursor === null || isLoadingPreviousRef.current) {
      return;
    }
    isLoadingPreviousRef.current = true;
    setIsLoadingPrevious(true);
    try {
      const page = await getItemComments(authenticatedRequest, collectionId, itemId, { before: previousCursor, unlockToken: tokenRef.current() });
      setComments(current => {
        const known = new Set(current.map(comment => comment.id));
        return [...page.items.filter(comment => !known.has(comment.id)), ...current];
      });
      setTotalCount(page.totalCount);
      setPreviousCursor(page.previousCursor);
    } catch {
      failureRef.current('older');
    } finally {
      isLoadingPreviousRef.current = false;
      setIsLoadingPrevious(false);
    }
  }, [authenticatedRequest, collectionId, itemId, previousCursor]);

  const send = useCallback(
    async (body: string): Promise<boolean> => {
      if (isSendingRef.current) {
        return false;
      }
      isSendingRef.current = true;
      setIsSending(true);
      try {
        const created = await addItemComment(authenticatedRequest, collectionId, itemId, body, tokenRef.current());
        setComments(current => (current.some(comment => comment.id === created.id) ? current : [...current, created]));
        setTotalCount(current => current + 1);
        return true;
      } catch {
        failureRef.current('send');
        return false;
      } finally {
        isSendingRef.current = false;
        setIsSending(false);
      }
    },
    [authenticatedRequest, collectionId, itemId],
  );

  const remove = useCallback(
    async (commentId: number) => {
      if (pendingDeletesRef.current.has(commentId)) {
        return;
      }
      pendingDeletesRef.current.add(commentId);
      const index = commentsRef.current.findIndex(comment => comment.id === commentId);
      const removed = index >= 0 ? { comment: commentsRef.current[index], index } : null;
      setComments(current => current.filter(comment => comment.id !== commentId));
      setTotalCount(current => Math.max(0, current - 1));
      try {
        await deleteItemComment(authenticatedRequest, collectionId, itemId, commentId, tokenRef.current());
      } catch {
        // Put it back where it was and say so.
        const restore = removed;
        if (restore) {
          setComments(current =>
            current.some(comment => comment.id === commentId)
              ? current
              : [...current.slice(0, restore.index), restore.comment, ...current.slice(restore.index)],
          );
          setTotalCount(current => current + 1);
        }
        failureRef.current('delete');
      } finally {
        pendingDeletesRef.current.delete(commentId);
      }
    },
    [authenticatedRequest, collectionId, itemId],
  );

  return { comments, totalCount, hasPrevious: previousCursor !== null, status, isLoadingPrevious, isSending, load, loadPrevious, send, remove } as const;
}

export { COMMENT_PAGE_SIZE };
