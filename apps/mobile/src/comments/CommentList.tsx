import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { LoadFailureState } from '../components/LoadFailureState';
import { ActionMenuDialog } from '../components/ActionMenuDialog';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { TrashIcon } from '../icons/TrashIcon';
import { colors, minTouchTarget, spacing } from '../theme/tokens';
import { CommentRow, REPLY_INDENT } from './CommentRow';
import type { ItemComment } from './commentsApi';
import type { CommentsStatus, ThreadState } from './useItemComments';

interface CommentListProps {
  readonly comments: readonly ItemComment[];
  readonly totalCount: number;
  readonly status: CommentsStatus;
  readonly hasPrevious: boolean;
  readonly isLoadingPrevious: boolean;
  /** The caller owns the Collection: every comment may be deleted. Otherwise only their own. */
  readonly canDeleteAny: boolean;
  readonly onLoadPrevious: () => void;
  readonly onRetry: () => void;
  readonly onDelete: (commentId: number) => void;
  /** The opened / loaded replies per thread (keyed by the top-level comment's id). Omitted: a list without threads. */
  readonly threads?: Readonly<Record<number, ThreadState>>;
  readonly onReply?: (comment: ItemComment) => void;
  readonly onToggleLike?: (comment: ItemComment) => void;
  readonly onToggleReplies?: (rootCommentId: number) => void;
  readonly onLoadMoreReplies?: (rootCommentId: number) => void;
  readonly onRetryReplies?: (rootCommentId: number) => void;
}

/**
 * The conversation under a link: "댓글 N", then - oldest to newest - the top-level comments, with "이전 댓글 보기"
 * above them while older ones exist. Under a comment that has replies, "답글 N개 보기" opens its thread (replies load
 * only then, a page at a time, all at ONE indent level) and "답글 숨기기" folds it again. Loading, a failed load and an
 * empty conversation each say so in this section only (the link above is already on screen); a reply page that fails
 * leaves the replies already shown where they are and offers a compact retry under them. Deleting goes through the
 * row's "..." menu and a confirmation, for the author's own comments and - for the Owner - any.
 */
export function CommentList({
  comments,
  totalCount,
  status,
  hasPrevious,
  isLoadingPrevious,
  canDeleteAny,
  onLoadPrevious,
  onRetry,
  onDelete,
  threads,
  onReply,
  onToggleLike,
  onToggleReplies,
  onLoadMoreReplies,
  onRetryReplies,
}: CommentListProps) {
  const { t } = useTranslation();
  const [menuFor, setMenuFor] = useState<ItemComment | null>(null);
  const [confirmFor, setConfirmFor] = useState<ItemComment | null>(null);

  const row = (comment: ItemComment, isReply: boolean) => (
    <CommentRow
      canDelete={!comment.isDeleted && (canDeleteAny || comment.author.isMe)}
      comment={comment}
      isReply={isReply}
      key={comment.id}
      onOpenMenu={setMenuFor}
      onReply={onReply}
      onToggleLike={onToggleLike}
    />
  );

  return (
    <View style={styles.section} testID="comments-section">
      <Text accessibilityRole="header" style={styles.title} testID="comments-title">{t('comments.title', { count: status === 'ready' ? totalCount : comments.length })}</Text>

      {status === 'loading' && comments.length === 0 ? (
        <View style={styles.state} testID="comments-loading"><ActivityIndicator size="small" /></View>
      ) : null}
      {status === 'error' && comments.length === 0 ? (
        <LoadFailureState compact onRetry={onRetry} testID="comments-error" />
      ) : null}
      {status === 'ready' && comments.length === 0 ? (
        <Text style={styles.stateText} testID="comments-empty">{t('comments.empty')}</Text>
      ) : null}

      {hasPrevious ? (
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ busy: isLoadingPrevious, disabled: isLoadingPrevious }}
          disabled={isLoadingPrevious}
          onPress={onLoadPrevious}
          style={styles.textAction}
          testID="comments-load-previous"
        >
          {isLoadingPrevious ? <ActivityIndicator size="small" /> : <Text style={styles.actionLabel}>{t('comments.loadPrevious')}</Text>}
        </Pressable>
      ) : null}

      {comments.map(comment => {
        const replyCount = comment.replyCount ?? 0;
        const thread = threads?.[comment.id];
        return (
          <View key={comment.id}>
            {row(comment, false)}
            {replyCount > 0 && onToggleReplies ? (
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ expanded: thread?.expanded === true }}
                onPress={() => onToggleReplies(comment.id)}
                style={[styles.textAction, styles.threadAction]}
                testID={`comment-replies-toggle-${comment.id}`}
              >
                <Text style={styles.actionLabel}>
                  {thread?.expanded ? t('comments.hideReplies') : t('comments.viewReplies', { count: replyCount })}
                </Text>
              </Pressable>
            ) : null}
            {thread?.expanded ? (
              <View testID={`comment-replies-${comment.id}`}>
                {thread.status === 'loading' && thread.replies.length === 0 ? (
                  <View style={[styles.state, styles.threadAction]} testID={`comment-replies-loading-${comment.id}`}><ActivityIndicator size="small" /></View>
                ) : null}
                {thread.status === 'error' && thread.replies.length === 0 ? (
                  <View style={styles.threadAction}>
                    <LoadFailureState compact onRetry={() => onRetryReplies?.(comment.id)} testID={`comment-replies-error-${comment.id}`} />
                  </View>
                ) : null}
                {thread.replies.map(reply => row(reply, true))}
                {thread.nextCursor !== null && thread.status === 'ready' ? (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityState={{ busy: thread.isLoadingMore, disabled: thread.isLoadingMore }}
                    disabled={thread.isLoadingMore}
                    onPress={() => onLoadMoreReplies?.(comment.id)}
                    style={[styles.textAction, styles.threadAction]}
                    testID={`comment-replies-more-${comment.id}`}
                  >
                    {thread.isLoadingMore ? (
                      <ActivityIndicator size="small" />
                    ) : (
                      <Text style={thread.moreFailed ? styles.failedLabel : styles.actionLabel}>
                        {thread.moreFailed ? t('comments.repliesLoadError') : t('comments.loadMoreReplies')}
                      </Text>
                    )}
                  </Pressable>
                ) : null}
              </View>
            ) : null}
          </View>
        );
      })}

      <ActionMenuDialog
        actions={[{ label: t('comments.delete'), destructive: true, icon: TrashIcon, onPress: () => { setConfirmFor(menuFor); setMenuFor(null); } }]}
        cancelLabel={t('common.cancel')}
        onCancel={() => setMenuFor(null)}
        visible={menuFor !== null}
      />
      <ConfirmDialog
        cancelLabel={t('common.cancel')}
        confirmLabel={t('common.delete')}
        message=""
        onCancel={() => setConfirmFor(null)}
        onConfirm={() => {
          const target = confirmFor;
          setConfirmFor(null);
          if (target) {
            onDelete(target.id);
          }
        }}
        title={t('comments.deleteConfirm')}
        visible={confirmFor !== null}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  section: { borderTopColor: colors.divider, borderTopWidth: 1, marginTop: spacing.lg, paddingTop: spacing.md },
  title: { color: colors.textPrimary, fontSize: 15, fontWeight: '700' },
  state: { alignItems: 'center', paddingVertical: spacing.md },
  stateText: { color: colors.textSecondary, fontSize: 13, marginTop: spacing.sm },
  textAction: { alignItems: 'center', alignSelf: 'flex-start', justifyContent: 'center', minHeight: minTouchTarget },
  // The thread controls line up with the replies' own single indent.
  threadAction: { marginStart: REPLY_INDENT },
  actionLabel: { color: colors.brand, fontSize: 14, fontWeight: '700' },
  failedLabel: { color: colors.danger, fontSize: 13, fontWeight: '700' },
});
