'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { AppDictionary } from '../../lib/appI18n';
import { formatMessage } from '../../lib/appI18n';
import { isSessionLost } from '../../lib/authSession';
import { collectionPath, type CollectionDetail } from '../../lib/collectionDetails';
import { unlockHeaders } from '../../lib/collectionUnlock';
import {
  canDeleteComment,
  canEditComment,
  canSubmitComment,
  emojiOfReaction,
  formatCommentTime,
  isCollaborationCollection,
  isSubmitEnter,
  itemReactionPath,
  MAX_COMMENT_LENGTH,
  nextReaction,
  ownsCollection,
  parseRecentReactions,
  personLabel,
  pushRecentReaction,
  REACTION_CATALOG,
  RECENT_REACTIONS_STORAGE_KEY,
  stripLegacyReplyMention,
  summarizeReactions,
  toItemReactions,
  withMyReaction,
  type ItemComment,
  type ItemReactions,
  type ReactionCount,
  type ReplyTarget,
} from '../../lib/itemCollaboration';
import { sharedItemPath } from '../../lib/itemDetails';
import { useSignedInApp } from './AppRoot';
import { Avatar } from './Avatar';
import { ConfirmDialog } from './ConfirmDialog';
import { CollectionGlyph, Glyph } from './Glyph';
import { useItemComments, type CommentFailure, type EditTarget } from './useItemComments';
import styles from './app.module.css';

/** What the server sent with a link of a Collection: its reaction counts and the caller's own (SharedCollectionItemDto). */
export interface CollaborationRow {
  readonly reactions?: readonly ReactionCount[] | null;
  readonly myReaction?: string | null;
}

/** How long a failure note stays under the section (mobile shows a toast for the same moments). */
const NOTICE_MS = 4000;

/**
 * The collaboration of one link IN one Collection - its emoji reactions and its comments - the same wherever the link is opened, as
 * mobile useItemCollaboration: the person's own link opened from a Collection (`row` omitted: the link's reactions in that Collection
 * are read here, and only when the Collection really has other people in it - shared with me, or mine with members), and another
 * member's link (`row` given, `always`: such a link only exists in a shared Collection). Nothing is drawn while the Collection is
 * unknown, not collaborative, locked without its grant, or the link is no longer in it.
 *
 * Everything here is its own state: reacting or commenting never reloads the link, its card or the page underneath.
 */
export function ItemCollaboration({
  collectionId,
  itemId,
  row,
  always = false,
}: {
  readonly collectionId: number;
  readonly itemId: number;
  /** The link's row as already read IN this Collection (another member's link); omitted = read it here. */
  readonly row?: CollaborationRow;
  readonly always?: boolean;
}) {
  const { api, onSessionLost } = useSignedInApp();
  const [context, setContext] = useState<{ readonly isOwner: boolean; readonly collaborative: boolean } | null>(null);
  const [ownRow, setOwnRow] = useState<CollaborationRow | null>(null);

  // The Collection itself: whether the caller owns it (every comment may then be deleted) and whether it is collaborative.
  useEffect(() => {
    let ignore = false;
    api<CollectionDetail>({ path: collectionPath(collectionId) }).then(
      collection => {
        if (!ignore) {
          setContext({ isOwner: ownsCollection(collection), collaborative: isCollaborationCollection(collection) });
        }
      },
      error => {
        if (ignore) {
          return;
        }
        if (isSessionLost(error)) {
          onSessionLost();
          return;
        }
        // Another member's link is collaborative by definition; the Owner's extra rights are then simply not offered.
        setContext(always ? { isOwner: false, collaborative: true } : null);
      },
    );
    return () => {
      ignore = true;
    };
  }, [always, api, collectionId, onSessionLost]);

  const collaborative = context !== null && (always || context.collaborative);
  const needsRow = row === undefined;

  // My own link: its reactions IN this Collection (with the visit's grant). Locked, gone or offline = no section, as on mobile.
  useEffect(() => {
    if (!collaborative || !needsRow) {
      return undefined;
    }
    let ignore = false;
    api<CollaborationRow>({ path: sharedItemPath(collectionId, itemId), headers: unlockHeaders(collectionId) }).then(
      result => {
        if (!ignore) {
          setOwnRow(result);
        }
      },
      error => {
        if (!ignore && isSessionLost(error)) {
          onSessionLost();
        }
      },
    );
    return () => {
      ignore = true;
    };
  }, [api, collaborative, collectionId, itemId, needsRow, onSessionLost]);

  const effectiveRow = row ?? ownRow;
  if (!collaborative || context === null || effectiveRow === null) {
    return null;
  }
  return <CollaborationSection collectionId={collectionId} isOwner={context.isOwner} itemId={itemId} row={effectiveRow} />;
}

function CollaborationSection({
  collectionId,
  itemId,
  isOwner,
  row,
}: {
  readonly collectionId: number;
  readonly itemId: number;
  readonly isOwner: boolean;
  readonly row: CollaborationRow;
}) {
  const { dictionary } = useSignedInApp();
  const [notice, setNotice] = useState<string | null>(null);
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showNotice = useCallback((message: string) => {
    setNotice(message);
    if (noticeTimer.current) {
      clearTimeout(noticeTimer.current);
    }
    noticeTimer.current = setTimeout(() => setNotice(null), NOTICE_MS);
  }, []);
  useEffect(() => () => {
    if (noticeTimer.current) {
      clearTimeout(noticeTimer.current);
    }
  }, []);

  const reactions = useItemReactions(collectionId, itemId, row, () => showNotice(dictionary.reactionError));
  const comments = useItemComments(collectionId, itemId, (kind: CommentFailure) =>
    showNotice(
      kind === 'send'
        ? dictionary.commentSendError
        : kind === 'delete'
          ? dictionary.commentDeleteError
          : kind === 'like'
            ? dictionary.commentLikeError
            : kind === 'edit'
              ? dictionary.commentEditError
              : dictionary.commentsLoadError,
    ),
  );
  const { recent, recordRecent } = useRecentReactions();
  const [pickerOpen, setPickerOpen] = useState(false);
  const react = (key: string) => {
    recordRecent(key);
    reactions.react(key);
  };

  return (
    <section className={styles.collab} data-collaboration>
      <ReactionChips dictionary={dictionary} onAdd={() => setPickerOpen(true)} onToggle={react} reactions={reactions.state} />
      <CommentList
        comments={comments}
        dictionary={dictionary}
        isOwner={isOwner}
      />
      {notice ? (
        <p className={styles.collabNotice} role="status">
          {notice}
        </p>
      ) : null}
      <CommentComposer
        dictionary={dictionary}
        key={comments.editTarget ? `edit-${comments.editTarget.commentId}` : 'new'}
        editTarget={comments.editTarget}
        isSending={comments.isSending}
        onCancelEdit={comments.cancelEdit}
        onCancelReply={comments.cancelReply}
        onSubmit={comments.editTarget ? comments.saveEdit : comments.send}
        replyTarget={comments.replyTarget}
      />
      <ReactionPicker
        dictionary={dictionary}
        myReaction={reactions.state.myReaction}
        onClose={() => setPickerOpen(false)}
        onSelect={key => {
          setPickerOpen(false);
          react(key);
        }}
        open={pickerOpen}
        recent={recent}
      />
    </section>
  );
}

// ---- reactions -------------------------------------------------------------------------------------------------------------------

/**
 * The link's reactions with the caller's taps applied at once (mobile useItemReactions): the same reaction as the caller's own takes it
 * back (DELETE), any other sets or changes it (PUT) - the counts move immediately, the server's answer settles them, a failure puts the
 * previous state back. One request at a time: a tap while the previous one is on its way is ignored, so counts are never applied twice.
 */
function useItemReactions(collectionId: number, itemId: number, row: CollaborationRow, onFailure: () => void) {
  const { api, onSessionLost } = useSignedInApp();
  const [state, setState] = useState<ItemReactions>(() => toItemReactions(row.reactions, row.myReaction));
  const inFlight = useRef(false);
  const failureRef = useRef(onFailure);
  useEffect(() => {
    failureRef.current = onFailure;
  }, [onFailure]);

  const react = (key: string) => {
    if (inFlight.current) {
      return;
    }
    const before = state;
    const next = nextReaction(before.myReaction, key);
    inFlight.current = true;
    setState(withMyReaction(before, next));
    const request =
      next === null
        ? api<ItemReactions>({ method: 'DELETE', path: itemReactionPath(collectionId, itemId), headers: unlockHeaders(collectionId) })
        : api<ItemReactions>({ method: 'PUT', path: itemReactionPath(collectionId, itemId), body: { reactionKey: next }, headers: unlockHeaders(collectionId) });
    request
      .then(
        answer => setState(toItemReactions(answer.reactions, answer.myReaction)),
        error => {
          setState(before);
          if (isSessionLost(error)) {
            onSessionLost();
          } else {
            failureRef.current();
          }
        },
      )
      .finally(() => {
        inFlight.current = false;
      });
  };

  return { state, react } as const;
}

/** This browser's recently used reactions (mobile useRecentReactions, in this browser's storage): failures are silent - no 최근 사용 then. */
function useRecentReactions() {
  // Read once when the section first appears (it only ever renders in the browser, after the Collection was read).
  const [recent, setRecent] = useState<readonly string[]>(() => {
    try {
      return typeof window === 'undefined' ? [] : parseRecentReactions(window.localStorage.getItem(RECENT_REACTIONS_STORAGE_KEY));
    } catch {
      // storage unavailable: no 최근 사용
      return [];
    }
  });
  const recordRecent = useCallback(
    (key: string) => {
      const next = pushRecentReaction(recent, key);
      setRecent(next);
      try {
        window.localStorage.setItem(RECENT_REACTIONS_STORAGE_KEY, JSON.stringify(next));
      } catch {
        // storage unavailable: kept for this page only
      }
    },
    [recent],
  );
  return { recent, recordRecent } as const;
}

/**
 * Mobile ReactionChips (alwaysShowAdd, the detail screen): "[❤️ 3] [👍 1] [😂 2] [+1] [☺+]" - the most used kinds first (ties in
 * catalog order), at most three, "+N" for the kinds beyond, then the add button. The caller's own is the chip with a ring.
 */
function ReactionChips({
  reactions,
  dictionary,
  onToggle,
  onAdd,
}: {
  readonly reactions: ItemReactions;
  readonly dictionary: AppDictionary;
  readonly onToggle: (key: string) => void;
  readonly onAdd: () => void;
}) {
  const { visible, hiddenKinds } = summarizeReactions(reactions.reactions);
  return (
    <div className={styles.reactionRow} data-reactions>
      {visible.map(reaction => {
        const emoji = emojiOfReaction(reaction.key) ?? '';
        const isMine = reactions.myReaction === reaction.key;
        return (
          <button
            aria-label={formatMessage(dictionary.reactionChipA11y, { emoji, count: reaction.count })}
            aria-pressed={isMine}
            className={isMine ? `${styles.reactionChip} ${styles.reactionChipMine}` : styles.reactionChip}
            data-reaction={reaction.key}
            key={reaction.key}
            onClick={() => onToggle(reaction.key)}
            type="button"
          >
            <span aria-hidden className={styles.reactionEmoji}>
              {emoji}
            </span>
            <span aria-hidden>{reaction.count}</span>
          </button>
        );
      })}
      {hiddenKinds > 0 ? (
        <span aria-label={formatMessage(dictionary.reactionMoreKindsA11y, { count: hiddenKinds })} className={styles.reactionChip} role="img">
          +{hiddenKinds}
        </span>
      ) : null}
      <button aria-label={dictionary.reactionAdd} className={styles.reactionChip} data-reaction-add onClick={onAdd} title={dictionary.reactionAdd} type="button">
        <Glyph name="SmileyPlus" size={16} />
      </button>
    </div>
  );
}

/** Mobile ReactionPickerDialog: "리액션 추가" - this browser's 최근 사용, then the whole catalog, six per row. Choosing one closes it. */
function ReactionPicker({
  open,
  myReaction,
  recent,
  dictionary,
  onSelect,
  onClose,
}: {
  readonly open: boolean;
  readonly myReaction: string | null;
  readonly recent: readonly string[];
  readonly dictionary: AppDictionary;
  readonly onSelect: (key: string) => void;
  readonly onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) {
      return;
    }
    if (open && !dialog.open) {
      dialog.showModal();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  const cell = (key: string, group: string) => {
    const emoji = emojiOfReaction(key);
    if (emoji === null) {
      return null;
    }
    const isMine = myReaction === key;
    return (
      <button
        aria-label={formatMessage(isMine ? dictionary.reactionMineA11y : dictionary.reactionA11y, { emoji })}
        aria-pressed={isMine}
        className={isMine ? `${styles.pickerCell} ${styles.pickerCellMine}` : styles.pickerCell}
        data-picker-reaction={key}
        key={`${group}-${key}`}
        onClick={() => onSelect(key)}
        type="button"
      >
        <span aria-hidden>{emoji}</span>
      </button>
    );
  };

  return (
    <dialog
      aria-labelledby="reaction-picker-title"
      className={styles.reactionPicker}
      onCancel={event => {
        event.preventDefault();
        onClose();
      }}
      onClick={event => {
        // A click on the backdrop lands on the dialog element itself.
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
      ref={ref}
    >
      <div className={styles.reactionPickerPanel}>
        <div className={styles.reactionPickerHeader}>
          <h2 className={styles.dialogTitle} id="reaction-picker-title">
            {dictionary.reactionPickerTitle}
          </h2>
          <button aria-label={dictionary.close} className={styles.iconButton} onClick={onClose} type="button">
            <Glyph name="Close" size={20} />
          </button>
        </div>
        {open ? (
          <div className={styles.reactionPickerBody}>
            {recent.length > 0 ? (
              <>
                <p className={styles.reactionPickerSection}>{dictionary.reactionRecent}</p>
                <div className={styles.pickerGrid}>{recent.map(key => cell(key, 'recent'))}</div>
              </>
            ) : null}
            <p className={styles.reactionPickerSection}>{dictionary.reactionAll}</p>
            <div className={styles.pickerGrid}>{REACTION_CATALOG.map(reaction => cell(reaction.key, 'all'))}</div>
          </div>
        ) : null}
      </div>
    </dialog>
  );
}

// ---- comments --------------------------------------------------------------------------------------------------------------------

/**
 * Mobile CommentList: "댓글 N", then - oldest to newest - the top-level comments, with "이전 댓글 보기" above them while older ones exist.
 * "답글 N개 보기" opens a thread (its replies load only then, a page at a time, all at ONE indent level) and "답글 숨기기" folds it.
 * Loading, a failed load and an empty conversation each say so in this section only. 수정하기 / 삭제하기 are offered only where the
 * caller may (mobile puts them behind a long-press; a pointer has none, so they sit in the comment's own action line).
 */
function CommentList({
  comments: model,
  dictionary,
  isOwner,
}: {
  readonly comments: ReturnType<typeof useItemComments>;
  readonly dictionary: AppDictionary;
  readonly isOwner: boolean;
}) {
  const { locale } = useSignedInApp();
  const [confirmFor, setConfirmFor] = useState<ItemComment | null>(null);
  const { comments, threads, status, totalCount } = model;

  const row = (comment: ItemComment, isReply: boolean) => (
    <CommentRow
      canDelete={canDeleteComment(comment, isOwner)}
      canEdit={canEditComment(comment)}
      comment={comment}
      dictionary={dictionary}
      isEditing={model.editTarget?.commentId === comment.id}
      isReply={isReply}
      key={comment.id}
      locale={locale}
      onDelete={() => setConfirmFor(comment)}
      onEdit={() => model.startEdit(comment)}
      onReply={() => model.startReply(comment)}
      onToggleLike={() => model.toggleLike(comment)}
    />
  );

  return (
    <div className={styles.commentSection} data-comments>
      <h3 className={styles.commentTitle}>{formatMessage(dictionary.commentsTitle, { count: status === 'ready' ? totalCount : comments.length })}</h3>

      {status === 'loading' && comments.length === 0 ? <p aria-busy className={styles.commentState}>…</p> : null}
      {status === 'error' && comments.length === 0 ? (
        <p className={styles.commentState}>
          {dictionary.commentsLoadError}{' '}
          <button className={styles.linkButton} onClick={model.load} type="button">
            {dictionary.retry}
          </button>
        </p>
      ) : null}
      {status === 'ready' && comments.length === 0 ? <p className={styles.commentState}>{dictionary.commentsEmpty}</p> : null}

      {model.hasPrevious ? (
        <button aria-busy={model.isLoadingPrevious} className={styles.commentTextAction} disabled={model.isLoadingPrevious} onClick={model.loadPrevious} type="button">
          {model.isLoadingPrevious ? '…' : dictionary.commentsLoadPrevious}
        </button>
      ) : null}

      <ol className={styles.commentList}>
        {comments.map(comment => {
          const replyCount = comment.replyCount ?? 0;
          const thread = threads[comment.id];
          return (
            <li key={comment.id}>
              {row(comment, false)}
              {replyCount > 0 ? (
                <button
                  aria-expanded={thread?.expanded === true}
                  className={`${styles.commentTextAction} ${styles.commentThreadAction}`}
                  data-replies-toggle={comment.id}
                  onClick={() => model.toggleReplies(comment.id)}
                  type="button"
                >
                  {thread?.expanded ? dictionary.commentHideReplies : formatMessage(dictionary.commentViewReplies, { count: replyCount })}
                </button>
              ) : null}
              {thread?.expanded ? (
                <div className={styles.commentReplies}>
                  {thread.status === 'loading' && thread.replies.length === 0 ? <p aria-busy className={styles.commentState}>…</p> : null}
                  {thread.status === 'error' && thread.replies.length === 0 ? (
                    <button className={`${styles.commentTextAction} ${styles.commentFailedAction}`} onClick={() => model.retryReplies(comment.id)} type="button">
                      {dictionary.commentRepliesLoadError}
                    </button>
                  ) : null}
                  {thread.replies.length > 0 ? <ol className={styles.commentList}>{thread.replies.map(reply => <li key={reply.id}>{row(reply, true)}</li>)}</ol> : null}
                  {thread.nextCursor !== null && thread.status === 'ready' ? (
                    <button
                      aria-busy={thread.isLoadingMore}
                      className={thread.moreFailed ? `${styles.commentTextAction} ${styles.commentFailedAction}` : styles.commentTextAction}
                      disabled={thread.isLoadingMore}
                      onClick={() => model.loadMoreReplies(comment.id)}
                      type="button"
                    >
                      {thread.isLoadingMore ? '…' : thread.moreFailed ? dictionary.commentRepliesLoadError : dictionary.commentLoadMoreReplies}
                    </button>
                  ) : null}
                </div>
              ) : null}
            </li>
          );
        })}
      </ol>

      <ConfirmDialog
        cancelLabel={dictionary.cancel}
        confirmLabel={dictionary.delete}
        destructive
        onCancel={() => setConfirmFor(null)}
        onConfirm={() => {
          const target = confirmFor;
          setConfirmFor(null);
          if (target) {
            model.remove(target.id);
          }
        }}
        open={confirmFor !== null}
        title={dictionary.commentDeleteConfirm}
      />
    </div>
  );
}

/**
 * Mobile CommentRow: the avatar, the nickname (a small crown for the Collection's Owner), the time, the plain text (never interpreted:
 * React renders it as text), "@name" in front of a reply to a reply (from the server's reply target - never parsed out of the text),
 * 답글 달기 under it and the heart with its count on the right edge. A deleted comment that others answered is only "삭제된 댓글입니다.".
 */
function CommentRow({
  comment,
  isReply,
  isEditing,
  canEdit,
  canDelete,
  dictionary,
  locale,
  onReply,
  onToggleLike,
  onEdit,
  onDelete,
}: {
  readonly comment: ItemComment;
  readonly isReply: boolean;
  readonly isEditing: boolean;
  readonly canEdit: boolean;
  readonly canDelete: boolean;
  readonly dictionary: AppDictionary;
  readonly locale: string;
  readonly onReply: () => void;
  readonly onToggleLike: () => void;
  readonly onEdit: () => void;
  readonly onDelete: () => void;
}) {
  const rowClass = isReply ? `${styles.commentRow} ${styles.commentRowReply}` : styles.commentRow;
  if (comment.isDeleted) {
    return (
      <div className={rowClass} data-comment={comment.id}>
        <p className={styles.commentDeleted}>{dictionary.commentDeleted}</p>
      </div>
    );
  }
  const { author } = comment;
  const name = personLabel(author);
  const replyToName = comment.replyTo ? personLabel(comment.replyTo) : null;
  const body = stripLegacyReplyMention(comment.body, replyToName);
  const liked = comment.viewerLiked === true;
  const likeCount = comment.likeCount ?? 0;
  return (
    <div className={isEditing ? `${rowClass} ${styles.commentRowEditing}` : rowClass} data-comment={comment.id}>
      <Avatar person={{ displayName: author.displayName, profileImageUrl: author.profileImageUrl }} size={isReply ? 24 : 28} />
      <div className={styles.commentMain}>
        <p className={styles.commentMeta}>
          {author.isCollectionOwner ? (
            <span aria-hidden className={styles.commentCrown}>
              <Glyph name="Crown" size={13} />
            </span>
          ) : null}
          {/* The crown has no words of its own: assistive technology hears "name (소유자)" instead of the plain name. */}
          <span aria-hidden={author.isCollectionOwner} className={styles.commentName} dir="auto">
            {name}
          </span>
          {author.isCollectionOwner ? <span className={styles.visuallyHidden}>{formatMessage(dictionary.commentOwnerA11y, { name })}</span> : null}
          <time className={styles.commentTime} dateTime={comment.createdAtUtc}>
            {formatCommentTime(comment.createdAtUtc, dictionary, locale)}
          </time>
        </p>
        <p className={styles.commentBody} dir="auto">
          {replyToName ? (
            <span className={styles.commentMention} dir="auto">
              @{replyToName}{' '}
            </span>
          ) : null}
          {body}
        </p>
        <div className={styles.commentActions}>
          <button className={styles.commentAction} data-comment-reply onClick={onReply} type="button">
            {dictionary.commentReply}
          </button>
          {canEdit ? (
            <button className={styles.commentAction} data-comment-edit onClick={onEdit} type="button">
              {dictionary.commentEdit}
            </button>
          ) : null}
          {canDelete ? (
            <button className={`${styles.commentAction} ${styles.commentActionDanger}`} data-comment-delete onClick={onDelete} type="button">
              {dictionary.commentDeleteAction}
            </button>
          ) : null}
        </div>
      </div>
      <button
        aria-label={`${liked ? dictionary.commentUnlike : dictionary.commentLike}${likeCount > 0 ? `, ${formatMessage(dictionary.commentLikeCountA11y, { count: likeCount })}` : ''}`}
        aria-pressed={liked}
        className={liked ? `${styles.commentHeart} ${styles.commentHeartOn}` : styles.commentHeart}
        data-comment-like
        onClick={onToggleLike}
        type="button"
      >
        {liked ? <Glyph name="HeartFilled" size={16} /> : <CollectionGlyph icon="Heart" size={16} />}
        {likeCount > 0 ? <span aria-hidden>{likeCount}</span> : null}
      </button>
    </div>
  );
}

/**
 * Mobile CommentComposer: up to 1000 characters, growing to about four lines. 전송 is off while the text is empty or only whitespace
 * and while a send is on its way (a double click never sends twice); the text is trimmed when sent, and a failed send keeps it. Reply
 * mode shows "OO님에게 답글" with an X above the field (nothing is put into the field); edit mode holds the comment's words, says
 * "댓글 수정" with an X and saves with 수정 (off until the words changed). Enter sends, Shift+Enter is a new line - never while an
 * input method is still composing.
 */
function CommentComposer({
  isSending,
  onSubmit,
  replyTarget,
  onCancelReply,
  editTarget,
  onCancelEdit,
  dictionary,
}: {
  readonly isSending: boolean;
  readonly onSubmit: (body: string) => Promise<boolean>;
  readonly replyTarget: ReplyTarget | null;
  readonly onCancelReply: () => void;
  readonly editTarget: EditTarget | null;
  readonly onCancelEdit: () => void;
  readonly dictionary: AppDictionary;
}) {
  // The composer is keyed by the edited comment (see CollaborationSection): starting an edit starts it with that comment's words,
  // leaving edit mode (cancel, or saved) starts it empty again - mobile's editTarget effect, without copying state in an effect.
  const [text, setText] = useState(editTarget?.body ?? '');
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const canSend = canSubmitComment(text, isSending, editTarget?.body ?? null);
  const replyId = replyTarget?.commentId ?? null;
  const editId = editTarget?.commentId ?? null;

  // Starting an answer or an edit puts the cursor into the field (at the end of the words being edited).
  useEffect(() => {
    const input = inputRef.current;
    if (input && (replyId !== null || editId !== null)) {
      input.focus();
      input.setSelectionRange(input.value.length, input.value.length);
    }
  }, [editId, replyId]);

  const send = () => {
    if (!canSend) {
      return;
    }
    onSubmit(text.trim()).then(sent => {
      if (sent) {
        setText('');
      }
    });
  };
  const placeholder = replyTarget && !editTarget ? dictionary.commentReplyPlaceholder : dictionary.commentPlaceholder;

  return (
    <form
      className={styles.commentComposer}
      data-comment-composer
      onSubmit={event => {
        event.preventDefault();
        send();
      }}
    >
      {editTarget ? (
        <div className={styles.composerMode}>
          <span>{dictionary.commentEditing}</span>
          <button aria-label={dictionary.commentCancelEdit} className={styles.composerModeClose} onClick={onCancelEdit} type="button">
            <Glyph name="Close" size={16} />
          </button>
        </div>
      ) : replyTarget ? (
        <div className={styles.composerMode}>
          <span dir="auto">{formatMessage(dictionary.commentReplyingTo, { name: replyTarget.name })}</span>
          <button aria-label={dictionary.commentCancelReply} className={styles.composerModeClose} onClick={onCancelReply} type="button">
            <Glyph name="Close" size={16} />
          </button>
        </div>
      ) : null}
      <div className={styles.composerBar}>
        <textarea
          aria-label={placeholder}
          className={styles.composerInput}
          dir="auto"
          maxLength={MAX_COMMENT_LENGTH}
          onChange={event => setText(event.target.value)}
          onKeyDown={event => {
            if (isSubmitEnter({ key: event.key, shiftKey: event.shiftKey, isComposing: event.nativeEvent.isComposing, keyCode: event.keyCode })) {
              event.preventDefault();
              send();
            } else if (event.key === 'Escape' && (editTarget || replyTarget)) {
              // Leaves the mode only - the sheet itself stays open.
              event.preventDefault();
              event.stopPropagation();
              if (editTarget) {
                onCancelEdit();
              } else {
                onCancelReply();
              }
            }
          }}
          placeholder={placeholder}
          readOnly={isSending}
          ref={inputRef}
          rows={1}
          value={text}
        />
        <button className={styles.composerSend} disabled={!canSend} type="submit">
          {editTarget ? dictionary.commentEditSave : dictionary.commentSend}
        </button>
      </div>
    </form>
  );
}
