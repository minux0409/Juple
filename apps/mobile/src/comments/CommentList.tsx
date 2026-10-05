import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { LoadFailureState } from '../components/LoadFailureState';
import { ActionMenuDialog } from '../components/ActionMenuDialog';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { TrashIcon } from '../icons/TrashIcon';
import { colors, minTouchTarget, spacing } from '../theme/tokens';
import { CommentRow } from './CommentRow';
import type { ItemComment } from './commentsApi';
import type { CommentsStatus } from './useItemComments';

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
}

/**
 * The conversation under a link: "댓글 N", then - oldest to newest - the comments, with "이전 댓글 보기"
 * above them while older ones exist. Loading, a failed load and an empty conversation each say so in
 * this section only (the link above is already on screen). Deleting goes through the row's "..." menu
 * and a confirmation, for the author's own comments and - for the Owner - any.
 */
export function CommentList({ comments, totalCount, status, hasPrevious, isLoadingPrevious, canDeleteAny, onLoadPrevious, onRetry, onDelete }: CommentListProps) {
  const { t } = useTranslation();
  const [menuFor, setMenuFor] = useState<ItemComment | null>(null);
  const [confirmFor, setConfirmFor] = useState<ItemComment | null>(null);

  return (
    <View style={styles.section} testID="comments-section">
      <Text accessibilityRole="header" style={styles.title} testID="comments-title">{t('comments.title', { count: status === 'ready' ? totalCount : comments.length })}</Text>

      {status === 'loading' && comments.length === 0 ? (
        <View style={styles.state} testID="comments-loading"><ActivityIndicator size="small" /></View>
      ) : null}
      {status === 'error' && comments.length === 0 ? (
        <LoadFailureState compact message={t('comments.loadError')} onRetry={onRetry} retryLabel={t('comments.retry')} testID="comments-error" />
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

      {comments.map(comment => (
        <CommentRow canDelete={canDeleteAny || comment.author.isMe} comment={comment} key={comment.id} onOpenMenu={setMenuFor} />
      ))}

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
  actionLabel: { color: colors.brand, fontSize: 14, fontWeight: '700' },
});
