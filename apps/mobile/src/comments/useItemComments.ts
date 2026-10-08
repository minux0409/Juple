import { useCallback, useEffect, useRef, useState } from 'react';
import type { AuthenticatedApiRequest } from '../api/useAuthenticatedApi';
import { personLabel } from '../collections/api/collaborationApi';
import {
  addItemComment,
  COMMENT_PAGE_SIZE,
  deleteItemComment,
  getCommentReplies,
  getItemComments,
  setCommentLike,
  type ItemComment,
} from './commentsApi';

export type CommentsStatus = 'loading' | 'ready' | 'error';

/** What the caller is answering: the exact comment, its thread root, and the name shown in the composer. */
export interface ReplyTarget {
  readonly commentId: number;
  readonly rootCommentId: number;
  readonly name: string;
  /** "@name" to put in front of the text - only for an answer to another REPLY (a direct answer is already under its parent). */
  readonly mention: string | null;
}

/** One thread's replies as the screen shows them. Lazy: nothing is fetched until the thread is opened. */
export interface ThreadState {
  readonly expanded: boolean;
  /** idle: never asked; loading/error: the FIRST page; ready: at least the first page is here. */
  readonly status: 'idle' | 'loading' | 'ready' | 'error';
  readonly replies: readonly ItemComment[];
  /** The "after" of the next page; null once the last page is loaded. */
  readonly nextCursor: number | null;
  readonly isLoadingMore: boolean;
  /** A later page failed: the replies already shown stay, a compact retry is offered. */
  readonly moreFailed: boolean;
}

const EMPTY_THREAD: ThreadState = { expanded: false, status: 'idle', replies: [], nextCursor: null, isLoadingMore: false, moreFailed: false };

/** The most older pages a notification's "bring me to that thread" will walk back through to find its root. */
const MAX_FOCUS_PAGES = 10;

type Threads = Readonly<Record<number, ThreadState>>;
type FailureKind = 'send' | 'delete' | 'older' | 'like';

/** A deleted comment keeps its row (its replies hang under it) but nothing of it: no words, no hearts. */
const toPlaceholder = (comment: ItemComment): ItemComment => ({ ...comment, body: '', isDeleted: true, likeCount: 0, viewerLiked: false });

/**
 * The conversation of ONE link: the newest page of top-level comments when the screen opens, older pages on request (prepended,
 * never duplicated) - and, per thread, the replies only when that thread is opened (one page at a time, then "more"). Adding,
 * answering, hearting or deleting changes only this state - the link's own screen state, reactions and everything else are never
 * reloaded for it.
 *
 * - send(body): one request at a time; with a reply target it is an answer to that comment. On success the server's own comment is
 *   added (a reply inside its thread, which opens) and the counts go up; on failure nothing changes, \`false\` is returned (the
 *   composer keeps its text and the reply target) and onFailure('send') reports it.
 * - remove(id): the row leaves at once (a comment others answered stays as a "deleted" placeholder, as the server decides) and the
 *   count goes down; a failure puts everything back.
 * - toggleLike(comment): the heart flips at once and is reconciled with the server's answer; a failure flips it back.
 * - toggleReplies / loadMoreReplies: lazy thread pages. A failed reply page never replaces what is already shown.
 * - loadPrevious(): the page before the oldest loaded one.
 */
export function useItemComments(
  authenticatedRequest: AuthenticatedApiRequest,
  collectionId: number,
  itemId: number,
  getUnlockToken: () => string | null,
  onFailure: (kind: FailureKind) => void,
  /** Off: nothing is requested (the link is not in a collaborative Collection here). */
  enabled = true,
  /** A notification's thread: once the comments are here, that thread (by its root comment id) is opened. */
  focusThreadRootId: number | null = null,
) {
  const [comments, setComments] = useState<readonly ItemComment[]>([]);
  const [threads, setThreads] = useState<Threads>({});
  const [totalCount, setTotalCount] = useState(0);
  const [previousCursor, setPreviousCursor] = useState<number | null>(null);
  const [status, setStatus] = useState<CommentsStatus>('loading');
  const [isLoadingPrevious, setIsLoadingPrevious] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [replyTarget, setReplyTarget] = useState<ReplyTarget | null>(null);
  const commentsRef = useRef<readonly ItemComment[]>([]);
  commentsRef.current = comments;
  const threadsRef = useRef<Threads>({});
  threadsRef.current = threads;
  const totalCountRef = useRef(0);
  totalCountRef.current = totalCount;
  const replyTargetRef = useRef<ReplyTarget | null>(null);
  replyTargetRef.current = replyTarget;
  const isSendingRef = useRef(false);
  const isLoadingPreviousRef = useRef(false);
  const pendingDeletesRef = useRef(new Set<number>());
  const pendingLikesRef = useRef(new Set<number>());
  const focusAppliedRef = useRef(false);
  const failureRef = useRef(onFailure);
  failureRef.current = onFailure;
  const tokenRef = useRef(getUnlockToken);
  tokenRef.current = getUnlockToken;

  const updateThread = useCallback((rootId: number, change: (thread: ThreadState) => ThreadState) => {
    setThreads(current => ({ ...current, [rootId]: change(current[rootId] ?? EMPTY_THREAD) }));
  }, []);

  const load = useCallback(async () => {
    setStatus('loading');
    try {
      const page = await getItemComments(authenticatedRequest, collectionId, itemId, { unlockToken: tokenRef.current() });
      setComments(page.items);
      setThreads({});
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

  // ---- replies (lazy, one page at a time) ----

  const loadFirstReplies = useCallback(
    async (rootId: number) => {
      updateThread(rootId, thread => ({ ...thread, status: 'loading' }));
      try {
        const page = await getCommentReplies(authenticatedRequest, collectionId, itemId, rootId, { unlockToken: tokenRef.current() });
        updateThread(rootId, thread => ({ ...thread, status: 'ready', replies: page.items, nextCursor: page.nextCursor, moreFailed: false }));
      } catch {
        updateThread(rootId, thread => ({ ...thread, status: 'error' }));
      }
    },
    [authenticatedRequest, collectionId, itemId, updateThread],
  );

  const toggleReplies = useCallback(
    (rootId: number) => {
      const thread = threadsRef.current[rootId] ?? EMPTY_THREAD;
      if (thread.expanded) {
        updateThread(rootId, current => ({ ...current, expanded: false }));
        return;
      }
      updateThread(rootId, current => ({ ...current, expanded: true }));
      if (thread.status === 'idle' || thread.status === 'error') {
        loadFirstReplies(rootId).catch(() => undefined);
      }
    },
    [loadFirstReplies, updateThread],
  );

  const retryReplies = useCallback(
    (rootId: number) => {
      loadFirstReplies(rootId).catch(() => undefined);
    },
    [loadFirstReplies],
  );

  const loadMoreReplies = useCallback(
    async (rootId: number) => {
      const thread = threadsRef.current[rootId];
      if (!thread || thread.nextCursor === null || thread.isLoadingMore) {
        return;
      }
      updateThread(rootId, current => ({ ...current, isLoadingMore: true, moreFailed: false }));
      try {
        const page = await getCommentReplies(authenticatedRequest, collectionId, itemId, rootId, { after: thread.nextCursor, unlockToken: tokenRef.current() });
        updateThread(rootId, current => {
          const known = new Set(current.replies.map(reply => reply.id));
          return { ...current, replies: [...current.replies, ...page.items.filter(reply => !known.has(reply.id))], nextCursor: page.nextCursor, isLoadingMore: false };
        });
      } catch {
        // The replies already shown stay; only a compact retry appears under them.
        updateThread(rootId, current => ({ ...current, isLoadingMore: false, moreFailed: true }));
      }
    },
    [authenticatedRequest, collectionId, itemId, updateThread],
  );

  // A notification's thread: open it once its root is among the loaded comments (walking back through older pages when needed).
  const focusPagesRef = useRef(0);
  useEffect(() => {
    if (focusThreadRootId === null || focusAppliedRef.current || status !== 'ready') {
      return;
    }
    if (commentsRef.current.some(comment => comment.id === focusThreadRootId)) {
      focusAppliedRef.current = true;
      if (!threadsRef.current[focusThreadRootId]?.expanded) {
        toggleReplies(focusThreadRootId);
      }
      return;
    }
    if (previousCursor !== null && !isLoadingPrevious && focusPagesRef.current < MAX_FOCUS_PAGES) {
      focusPagesRef.current += 1;
      loadPrevious().catch(() => undefined);
    }
  }, [comments, focusThreadRootId, isLoadingPrevious, loadPrevious, previousCursor, status, toggleReplies]);

  // ---- writing ----

  const startReply = useCallback((comment: ItemComment) => {
    if (comment.isDeleted) {
      return;
    }
    const name = personLabel({ jupleId: comment.author.jupleId, displayName: comment.author.displayName });
    const isReply = comment.rootCommentId !== null && comment.rootCommentId !== undefined;
    setReplyTarget({ commentId: comment.id, rootCommentId: comment.rootCommentId ?? comment.id, name, mention: isReply ? `@${name}` : null });
  }, []);

  const cancelReply = useCallback(() => setReplyTarget(null), []);

  const send = useCallback(
    async (body: string): Promise<boolean> => {
      if (isSendingRef.current) {
        return false;
      }
      isSendingRef.current = true;
      setIsSending(true);
      const target = replyTargetRef.current;
      try {
        // A top-level comment is exactly the call it always was; only an answer carries the answered comment's id.
        const created = target
          ? await addItemComment(authenticatedRequest, collectionId, itemId, body, tokenRef.current(), target.commentId)
          : await addItemComment(authenticatedRequest, collectionId, itemId, body, tokenRef.current());
        const rootId = created.rootCommentId ?? null;
        if (rootId === null) {
          setComments(current => (current.some(comment => comment.id === created.id) ? current : [...current, created]));
        } else {
          setComments(current => current.map(comment => (comment.id === rootId ? { ...comment, replyCount: (comment.replyCount ?? 0) + 1 } : comment)));
          const thread = threadsRef.current[rootId];
          if (thread && thread.status === 'ready' && thread.nextCursor === null) {
            updateThread(rootId, current => ({
              ...current,
              expanded: true,
              replies: current.replies.some(reply => reply.id === created.id) ? current.replies : [...current.replies, created],
            }));
          } else if (!thread || thread.status === 'idle' || thread.status === 'error') {
            updateThread(rootId, current => ({ ...current, expanded: true }));
            loadFirstReplies(rootId).catch(() => undefined);
          } else {
            updateThread(rootId, current => ({ ...current, expanded: true }));
          }
          setReplyTarget(null);
        }
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
    [authenticatedRequest, collectionId, itemId, loadFirstReplies, updateThread],
  );

  const remove = useCallback(
    async (commentId: number) => {
      if (pendingDeletesRef.current.has(commentId)) {
        return;
      }
      pendingDeletesRef.current.add(commentId);
      const snapshot = { comments: commentsRef.current, threads: threadsRef.current, totalCount: totalCountRef.current };
      const topLevel = snapshot.comments.find(comment => comment.id === commentId);
      const rootId = topLevel ? null : Object.keys(snapshot.threads).map(Number).find(id => snapshot.threads[id].replies.some(reply => reply.id === commentId)) ?? null;
      const reply = rootId === null ? null : snapshot.threads[rootId].replies.find(entry => entry.id === commentId) ?? null;

      if (topLevel) {
        // Answered by anyone: the thread stays under a placeholder. Otherwise it simply goes.
        if ((topLevel.replyCount ?? 0) > 0) {
          setComments(current => current.map(comment => (comment.id === commentId ? toPlaceholder(comment) : comment)));
        } else {
          setComments(current => current.filter(comment => comment.id !== commentId));
        }
      } else if (reply && rootId !== null) {
        const answered = snapshot.threads[rootId].replies.some(entry => entry.parentCommentId === commentId);
        if (answered) {
          updateThread(rootId, thread => ({ ...thread, replies: thread.replies.map(entry => (entry.id === commentId ? toPlaceholder(entry) : entry)) }));
        } else {
          const pruned = pruneAfterReplyRemoved(snapshot.comments, snapshot.threads, rootId, commentId);
          setComments(pruned.comments);
          setThreads(pruned.threads);
        }
      } else {
        pendingDeletesRef.current.delete(commentId);
        return;
      }
      setTotalCount(current => Math.max(0, current - 1));
      try {
        await deleteItemComment(authenticatedRequest, collectionId, itemId, commentId, tokenRef.current());
      } catch {
        // Put everything back where it was and say so.
        setComments(snapshot.comments);
        setThreads(snapshot.threads);
        setTotalCount(snapshot.totalCount);
        failureRef.current('delete');
      } finally {
        pendingDeletesRef.current.delete(commentId);
      }
    },
    [authenticatedRequest, collectionId, itemId, updateThread],
  );

  const toggleLike = useCallback(
    async (target: ItemComment) => {
      if (target.isDeleted || pendingLikesRef.current.has(target.id)) {
        return;
      }
      pendingLikesRef.current.add(target.id);
      const before = { liked: target.viewerLiked === true, count: target.likeCount ?? 0 };
      const wanted = !before.liked;
      const apply = (liked: boolean, count: number) => {
        const change = (entry: ItemComment): ItemComment => (entry.id === target.id ? { ...entry, viewerLiked: liked, likeCount: Math.max(0, count) } : entry);
        setComments(current => current.map(change));
        setThreads(current => {
          const next: Record<number, ThreadState> = {};
          for (const key of Object.keys(current).map(Number)) {
            next[key] = { ...current[key], replies: current[key].replies.map(change) };
          }
          return next;
        });
      };
      apply(wanted, before.count + (wanted ? 1 : -1));
      try {
        const state = await setCommentLike(authenticatedRequest, collectionId, itemId, target.id, wanted, tokenRef.current());
        apply(state.liked, state.likeCount);
      } catch {
        apply(before.liked, before.count);
        failureRef.current('like');
      } finally {
        pendingLikesRef.current.delete(target.id);
      }
    },
    [authenticatedRequest, collectionId, itemId],
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
    load,
    loadPrevious,
    send,
    remove,
    toggleLike,
    toggleReplies,
    loadMoreReplies,
    retryReplies,
    startReply,
    cancelReply,
  } as const;
}

/**
 * A reply that nobody answered is gone for good - and so is a "deleted" placeholder it was the last answer to (up the chain, as far as
 * the loaded replies show), exactly as the server cleans up. The thread's top-level comment, if only a placeholder with no replies
 * left, goes too.
 */
function pruneAfterReplyRemoved(
  comments: readonly ItemComment[],
  threads: Threads,
  rootId: number,
  replyId: number,
): { readonly comments: readonly ItemComment[]; readonly threads: Threads } {
  const thread = threads[rootId];
  let replies = thread.replies.filter(entry => entry.id !== replyId);
  let removed = 1;
  let parentId = thread.replies.find(entry => entry.id === replyId)?.parentCommentId ?? rootId;
  while (parentId !== rootId) {
    const parent = replies.find(entry => entry.id === parentId);
    if (!parent || !parent.isDeleted || replies.some(entry => entry.parentCommentId === parent.id)) {
      break;
    }
    replies = replies.filter(entry => entry.id !== parent.id);
    removed += 1;
    parentId = parent.parentCommentId ?? rootId;
  }

  let nextComments = comments.map(comment =>
    comment.id === rootId ? { ...comment, replyCount: Math.max(0, (comment.replyCount ?? 0) - removed) } : comment,
  );
  const root = nextComments.find(comment => comment.id === rootId);
  if (root?.isDeleted && (root.replyCount ?? 0) === 0) {
    nextComments = nextComments.filter(comment => comment.id !== rootId);
    const rest: Record<number, ThreadState> = { ...threads };
    delete rest[rootId];
    return { comments: nextComments, threads: rest };
  }
  return { comments: nextComments, threads: { ...threads, [rootId]: { ...thread, replies } } };
}

export { COMMENT_PAGE_SIZE };
