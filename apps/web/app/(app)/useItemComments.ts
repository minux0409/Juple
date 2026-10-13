'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { isSessionLost } from '../../lib/authSession';
import { unlockHeaders } from '../../lib/collectionUnlock';
import {
  appendReplies,
  commentCreateBody,
  commentLikePath,
  commentPath,
  commentRepliesPath,
  commentsCreatePath,
  commentsPagePath,
  EMPTY_THREAD,
  mapReplies,
  mapTopLevel,
  prependOlder,
  replyTargetOf,
  withCommentRemoved,
  withCreatedComment,
  withLike,
  type CommentLikeState,
  type CommentReplyPage,
  type ItemComment,
  type ItemCommentPage,
  type ReplyTarget,
  type Threads,
  type ThreadState,
} from '../../lib/itemCollaboration';
import { useSignedInApp } from './AppRoot';

export type CommentsStatus = 'loading' | 'ready' | 'error';
export type CommentFailure = 'send' | 'delete' | 'older' | 'like' | 'edit';

/** The comment being edited: its id and the words it had when editing started. */
export interface EditTarget {
  readonly commentId: number;
  readonly body: string;
}

/**
 * The conversation of ONE link in ONE Collection - the mobile useItemComments on the Web API: the newest page of top-level comments
 * when the section mounts, older pages on request (prepended, never duplicated), and per thread the replies only when it is opened.
 * Writing, answering, hearting or deleting changes only this state: the link, its card and the page underneath are never reloaded.
 *
 *  - send / saveEdit: one request at a time; resolve false on failure (the composer keeps its text, reply or edit target).
 *  - remove: the row leaves at once (a comment others answered becomes a placeholder, as the server decides); a failure puts it back.
 *  - toggleLike: the heart flips at once and is settled by the server's answer; a failure flips it back. One request per comment.
 * Every request carries this Collection's visit grant (its lock / share password) when one is held.
 */
export function useItemComments(collectionId: number, itemId: number, onFailure: (kind: CommentFailure) => void) {
  const { api, onSessionLost } = useSignedInApp();
  const [comments, setComments] = useState<readonly ItemComment[]>([]);
  const [threads, setThreads] = useState<Threads>({});
  const [totalCount, setTotalCount] = useState(0);
  const [previousCursor, setPreviousCursor] = useState<number | null>(null);
  const [status, setStatus] = useState<CommentsStatus>('loading');
  const [isLoadingPrevious, setIsLoadingPrevious] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [replyTarget, setReplyTarget] = useState<ReplyTarget | null>(null);
  const [editTarget, setEditTarget] = useState<EditTarget | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  // Guards against a second request while one is on its way - set and cleared only in event handlers and request callbacks.
  const isSendingRef = useRef(false);
  const isLoadingPreviousRef = useRef(false);
  const pendingDeletesRef = useRef(new Set<number>());
  const pendingLikesRef = useRef(new Set<number>());
  const failureRef = useRef(onFailure);
  useEffect(() => {
    failureRef.current = onFailure;
  }, [onFailure]);

  /** A lost session ends the visit for the whole app; anything else is this section's own failure. */
  const report = useCallback(
    (error: unknown, kind: CommentFailure | null) => {
      if (isSessionLost(error)) {
        onSessionLost();
      } else if (kind) {
        failureRef.current(kind);
      }
    },
    [onSessionLost],
  );

  const updateThread = useCallback((rootId: number, change: (thread: ThreadState) => ThreadState) => {
    setThreads(current => ({ ...current, [rootId]: change(current[rootId] ?? EMPTY_THREAD) }));
  }, []);

  // The newest page - when the section mounts, and again after a failed load's 다시 시도.
  useEffect(() => {
    let ignore = false;
    api<ItemCommentPage>({ path: commentsPagePath(collectionId, itemId), headers: unlockHeaders(collectionId) }).then(
      page => {
        if (ignore) {
          return;
        }
        setComments(page.items);
        setThreads({});
        setTotalCount(page.totalCount);
        setPreviousCursor(page.previousCursor);
        setStatus('ready');
      },
      error => {
        if (ignore) {
          return;
        }
        report(error, null);
        setStatus('error');
      },
    );
    return () => {
      ignore = true;
    };
  }, [api, collectionId, itemId, reloadToken, report]);

  const load = useCallback(() => {
    setStatus('loading');
    setReloadToken(token => token + 1);
  }, []);

  const loadPrevious = useCallback(() => {
    if (previousCursor === null || isLoadingPreviousRef.current) {
      return;
    }
    isLoadingPreviousRef.current = true;
    setIsLoadingPrevious(true);
    api<ItemCommentPage>({ path: commentsPagePath(collectionId, itemId, previousCursor), headers: unlockHeaders(collectionId) })
      .then(
        page => {
          setComments(current => prependOlder(current, page.items));
          setTotalCount(page.totalCount);
          setPreviousCursor(page.previousCursor);
        },
        error => report(error, 'older'),
      )
      .finally(() => {
        isLoadingPreviousRef.current = false;
        setIsLoadingPrevious(false);
      });
  }, [api, collectionId, itemId, previousCursor, report]);

  // ---- replies (lazy, one page at a time) ----

  const loadFirstReplies = useCallback(
    (rootId: number) => {
      updateThread(rootId, thread => ({ ...thread, status: 'loading' }));
      api<CommentReplyPage>({ path: commentRepliesPath(collectionId, itemId, rootId), headers: unlockHeaders(collectionId) }).then(
        page => updateThread(rootId, thread => ({ ...thread, status: 'ready', replies: page.items, nextCursor: page.nextCursor, moreFailed: false })),
        error => {
          report(error, null);
          updateThread(rootId, thread => ({ ...thread, status: 'error' }));
        },
      );
    },
    [api, collectionId, itemId, report, updateThread],
  );

  const toggleReplies = useCallback(
    (rootId: number) => {
      const thread = threads[rootId] ?? EMPTY_THREAD;
      updateThread(rootId, current => ({ ...current, expanded: !thread.expanded }));
      if (!thread.expanded && (thread.status === 'idle' || thread.status === 'error')) {
        loadFirstReplies(rootId);
      }
    },
    [loadFirstReplies, threads, updateThread],
  );

  const loadMoreReplies = useCallback(
    (rootId: number) => {
      const thread = threads[rootId];
      if (!thread || thread.nextCursor === null || thread.isLoadingMore) {
        return;
      }
      updateThread(rootId, current => ({ ...current, isLoadingMore: true, moreFailed: false }));
      api<CommentReplyPage>({ path: commentRepliesPath(collectionId, itemId, rootId, thread.nextCursor), headers: unlockHeaders(collectionId) }).then(
        page => updateThread(rootId, current => ({ ...current, replies: appendReplies(current.replies, page.items), nextCursor: page.nextCursor, isLoadingMore: false })),
        error => {
          report(error, null);
          // The replies already shown stay; only a compact retry appears under them.
          updateThread(rootId, current => ({ ...current, isLoadingMore: false, moreFailed: true }));
        },
      );
    },
    [api, collectionId, itemId, report, threads, updateThread],
  );

  // ---- reply / edit modes of the one composer ----

  const startReply = useCallback((comment: ItemComment) => {
    const target = replyTargetOf(comment);
    if (target) {
      setEditTarget(null);
      setReplyTarget(target);
    }
  }, []);
  const cancelReply = useCallback(() => setReplyTarget(null), []);

  const startEdit = useCallback((comment: ItemComment) => {
    if (comment.isDeleted || !comment.author.isMe) {
      return;
    }
    setReplyTarget(null);
    setEditTarget({ commentId: comment.id, body: comment.body });
  }, []);
  const cancelEdit = useCallback(() => setEditTarget(null), []);

  // ---- writing ----

  const send = useCallback(
    async (body: string): Promise<boolean> => {
      if (isSendingRef.current) {
        return false;
      }
      isSendingRef.current = true;
      setIsSending(true);
      const target = replyTarget;
      try {
        const created = await api<ItemComment>({
          method: 'POST',
          path: commentsCreatePath(collectionId, itemId),
          body: commentCreateBody(body, target?.commentId ?? null),
          headers: unlockHeaders(collectionId),
        });
        setComments(current => withCreatedComment(current, created));
        const rootId = created.rootCommentId ?? null;
        if (rootId !== null) {
          const thread = threads[rootId];
          if (thread && thread.status === 'ready' && thread.nextCursor === null) {
            updateThread(rootId, current => ({ ...current, expanded: true, replies: appendReplies(current.replies, [created]) }));
          } else if (!thread || thread.status === 'idle' || thread.status === 'error') {
            updateThread(rootId, current => ({ ...current, expanded: true }));
            loadFirstReplies(rootId);
          } else {
            updateThread(rootId, current => ({ ...current, expanded: true }));
          }
          setReplyTarget(null);
        }
        setTotalCount(current => current + 1);
        return true;
      } catch (error) {
        report(error, 'send');
        return false;
      } finally {
        isSendingRef.current = false;
        setIsSending(false);
      }
    },
    [api, collectionId, itemId, loadFirstReplies, replyTarget, report, threads, updateThread],
  );

  /** Saves the new words in place: replies, hearts, the thread's open state and the reply target stay as they were. */
  const saveEdit = useCallback(
    async (body: string): Promise<boolean> => {
      const target = editTarget;
      if (!target || isSendingRef.current) {
        return false;
      }
      isSendingRef.current = true;
      setIsSending(true);
      try {
        const saved = await api<ItemComment>({
          method: 'PUT',
          path: commentPath(collectionId, itemId, target.commentId),
          body: { body },
          headers: unlockHeaders(collectionId),
        });
        const change = (entry: ItemComment) => ({ ...entry, body: saved.body });
        setComments(current => mapTopLevel(current, target.commentId, change));
        setThreads(current => mapReplies(current, target.commentId, change));
        setEditTarget(null);
        return true;
      } catch (error) {
        report(error, 'edit');
        return false;
      } finally {
        isSendingRef.current = false;
        setIsSending(false);
      }
    },
    [api, collectionId, editTarget, itemId, report],
  );

  const remove = useCallback(
    (commentId: number) => {
      if (pendingDeletesRef.current.has(commentId)) {
        return;
      }
      const snapshot = { comments, threads, totalCount };
      const next = withCommentRemoved(comments, threads, commentId);
      if (!next) {
        return;
      }
      pendingDeletesRef.current.add(commentId);
      setComments(next.comments);
      setThreads(next.threads);
      setTotalCount(current => Math.max(0, current - 1));
      if (editTarget?.commentId === commentId) {
        setEditTarget(null);
      }
      if (replyTarget?.commentId === commentId) {
        setReplyTarget(null);
      }
      api<void>({ method: 'DELETE', path: commentPath(collectionId, itemId, commentId), headers: unlockHeaders(collectionId) })
        .catch(error => {
          // Put everything back where it was and say so.
          setComments(snapshot.comments);
          setThreads(snapshot.threads);
          setTotalCount(snapshot.totalCount);
          report(error, 'delete');
        })
        .finally(() => pendingDeletesRef.current.delete(commentId));
    },
    [api, collectionId, comments, editTarget, itemId, replyTarget, report, threads, totalCount],
  );

  const toggleLike = useCallback(
    (target: ItemComment) => {
      if (target.isDeleted || pendingLikesRef.current.has(target.id)) {
        return;
      }
      pendingLikesRef.current.add(target.id);
      const before = { liked: target.viewerLiked === true, count: target.likeCount ?? 0 };
      const wanted = !before.liked;
      const apply = (liked: boolean, count: number) => {
        const change = (entry: ItemComment) => withLike(entry, liked, count);
        setComments(current => mapTopLevel(current, target.id, change));
        setThreads(current => mapReplies(current, target.id, change));
      };
      apply(wanted, before.count + (wanted ? 1 : -1));
      api<CommentLikeState>({ method: wanted ? 'PUT' : 'DELETE', path: commentLikePath(collectionId, itemId, target.id), headers: unlockHeaders(collectionId) })
        .then(
          state => apply(state.liked, state.likeCount),
          error => {
            apply(before.liked, before.count);
            report(error, 'like');
          },
        )
        .finally(() => pendingLikesRef.current.delete(target.id));
    },
    [api, collectionId, itemId, report],
  );

  return {
    comments,
    threads,
    totalCount,
    hasPrevious: previousCursor !== null,
    status,
    isLoadingPrevious,
    isSending,
    replyTarget,
    editTarget,
    load,
    loadPrevious,
    toggleReplies,
    retryReplies: loadFirstReplies,
    loadMoreReplies,
    startReply,
    cancelReply,
    startEdit,
    cancelEdit,
    send,
    saveEdit,
    remove,
    toggleLike,
  } as const;
}
