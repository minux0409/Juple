import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { personLabel } from '../collections/api/collaborationApi';
import { UserAvatar } from '../components/UserAvatar';
import { CrownIcon } from '../icons/CrownIcon';
import { HeartIcon } from '../icons/HeartIcon';
import { MoreIcon } from '../icons/MoreIcon';
import { colors, minTouchTarget, spacing } from '../theme/tokens';
import type { ItemComment } from './commentsApi';
import { formatCommentTime } from './formatCommentTime';

const AVATAR_SIZE = 28;
const REPLY_AVATAR_SIZE = 24;
/** Replies of every depth sit under the top-level comment at this ONE indent - the avatar column plus its gap. */
export const REPLY_INDENT = AVATAR_SIZE + spacing.sm;

interface CommentRowProps {
  readonly comment: ItemComment;
  /** Their own comment, or any comment for the Collection's Owner - the server decides the same. */
  readonly canDelete: boolean;
  readonly onOpenMenu: (comment: ItemComment) => void;
  /** Starts an answer to this comment (top-level or reply). Without it the row shows no 답글 달기. */
  readonly onReply?: (comment: ItemComment) => void;
  /** Hearts / un-hearts it. Without it the row shows no heart. */
  readonly onToggleLike?: (comment: ItemComment) => void;
  /** A reply inside a thread: one indent level (never deeper), a smaller avatar. */
  readonly isReply?: boolean;
}

/**
 * One comment as a line of the conversation (no card around it): the author's avatar - with a small
 * crown when they own the Collection (no 소유자 text; the screen reader hears it) - their nickname, the
 * time, and the text below, then 답글 달기. A heart with the number of hearts sits on the right. The text is
 * plain text only: whatever was typed, never interpreted. A reply to another reply starts with the answered
 * person's name ("@name", from the server's reply target - never parsed out of the text). A small "..." opens
 * the delete menu where the caller may delete it. A deleted comment that others answered is only
 * "삭제된 댓글입니다." - nothing of the person or the words.
 */
export function CommentRow({ comment, canDelete, onOpenMenu, onReply, onToggleLike, isReply = false }: CommentRowProps) {
  const { t } = useTranslation();
  const indentStyle = isReply ? styles.replyIndent : null;

  if (comment.isDeleted) {
    return (
      <View style={[styles.row, indentStyle]} testID={`comment-${comment.id}`}>
        <View accessible style={styles.deletedBox}>
          <Text style={styles.deletedText} testID={`comment-deleted-${comment.id}`}>{t('comments.deleted')}</Text>
        </View>
      </View>
    );
  }

  const { author } = comment;
  const name = personLabel({ jupleId: author.jupleId, displayName: author.displayName });
  const time = formatCommentTime(comment.createdAtUtc, t);
  const mention = comment.replyTo ? `@${personLabel({ jupleId: comment.replyTo.jupleId, displayName: comment.replyTo.displayName })}` : null;
  const liked = comment.viewerLiked === true;
  const likeCount = comment.likeCount ?? 0;
  return (
    <View style={[styles.row, indentStyle]} testID={`comment-${comment.id}`}>
      <UserAvatar
        displayName={author.displayName}
        imageUrl={author.profileImageUrl}
        imageVersion={author.profileImageVersion}
        jupleId={author.jupleId}
        size={isReply ? REPLY_AVATAR_SIZE : AVATAR_SIZE}
      />
      <View style={styles.main}>
        <View
          accessibilityLabel={`${author.isCollectionOwner ? t('comments.ownerA11y', { name }) : name}, ${time}. ${mention ? `${mention} ` : ''}${comment.body}`}
          accessible
        >
          <View style={styles.meta}>
            {author.isCollectionOwner ? <CrownIcon color={colors.warning} size={13} /> : null}
            <Text numberOfLines={1} style={styles.name}>{name}</Text>
            <Text numberOfLines={1} style={styles.time}>{time}</Text>
          </View>
          {/* Plain text, nothing parsed: no links, no markup. Long unbroken text wraps instead of overflowing. */}
          <Text selectable style={styles.body} testID={`comment-body-${comment.id}`}>
            {mention
              ? [<Text key="mention" style={styles.mention} testID={`comment-mention-${comment.id}`}>{`${mention} `}</Text>, comment.body]
              : comment.body}
          </Text>
        </View>
        {onReply ? (
          <Pressable
            accessibilityRole="button"
            onPress={() => onReply(comment)}
            style={styles.replyAction}
            testID={`comment-reply-${comment.id}`}
          >
            <Text style={styles.replyLabel}>{t('comments.reply')}</Text>
          </Pressable>
        ) : null}
      </View>
      <View style={styles.side}>
        {canDelete ? (
          <Pressable
            accessibilityLabel={t('comments.moreA11y')}
            accessibilityRole="button"
            hitSlop={8}
            onPress={() => onOpenMenu(comment)}
            style={styles.more}
            testID={`comment-more-${comment.id}`}
          >
            <MoreIcon color={colors.textSecondary} size={18} />
          </Pressable>
        ) : null}
        {onToggleLike ? (
          <Pressable
            accessibilityLabel={`${liked ? t('comments.unlike') : t('comments.like')}${likeCount > 0 ? `, ${t('comments.likeCountA11y', { count: likeCount })}` : ''}`}
            accessibilityRole="button"
            accessibilityState={{ selected: liked }}
            onPress={() => onToggleLike(comment)}
            style={styles.heart}
            testID={`comment-like-${comment.id}`}
          >
            <HeartIcon color={liked ? colors.danger : colors.textSecondary} filled={liked} size={18} />
            {likeCount > 0 ? <Text style={[styles.likeCount, liked && styles.likeCountOn]} testID={`comment-like-count-${comment.id}`}>{likeCount}</Text> : null}
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { alignItems: 'flex-start', columnGap: spacing.sm, flexDirection: 'row', paddingVertical: spacing.sm },
  replyIndent: { marginStart: REPLY_INDENT },
  main: { flex: 1, minWidth: 0 },
  meta: { alignItems: 'center', columnGap: spacing.xs, flexDirection: 'row' },
  name: { color: colors.textPrimary, flexShrink: 1, fontSize: 13, fontWeight: '700' },
  time: { color: colors.textSecondary, flexShrink: 0, fontSize: 12 },
  body: { color: colors.textPrimary, fontSize: 14, lineHeight: 20, marginTop: 2 },
  mention: { color: colors.brand, fontWeight: '700' },
  // 44dp to touch, a quiet text link to look at.
  replyAction: { alignSelf: 'flex-start', justifyContent: 'center', minHeight: minTouchTarget, paddingEnd: spacing.md },
  replyLabel: { color: colors.textSecondary, fontSize: 12, fontWeight: '700' },
  side: { alignItems: 'center', flexShrink: 0 },
  // 44dp to touch, a quiet three-dot glyph to look at.
  more: { alignItems: 'center', height: minTouchTarget - 8, justifyContent: 'center', width: minTouchTarget - 8 },
  heart: { alignItems: 'center', justifyContent: 'center', minHeight: minTouchTarget, minWidth: minTouchTarget },
  likeCount: { color: colors.textSecondary, fontSize: 11, marginTop: 1 },
  likeCountOn: { color: colors.danger },
  deletedBox: { flex: 1, minHeight: minTouchTarget - 16, justifyContent: 'center' },
  deletedText: { color: colors.textSecondary, fontSize: 13, fontStyle: 'italic' },
});
