import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { personLabel } from '../collections/api/collaborationApi';
import { UserAvatar } from '../components/UserAvatar';
import { CrownIcon } from '../icons/CrownIcon';
import { MoreIcon } from '../icons/MoreIcon';
import { colors, minTouchTarget, spacing } from '../theme/tokens';
import type { ItemComment } from './commentsApi';
import { formatCommentTime } from './formatCommentTime';

const AVATAR_SIZE = 28;

interface CommentRowProps {
  readonly comment: ItemComment;
  /** Their own comment, or any comment for the Collection's Owner - the server decides the same. */
  readonly canDelete: boolean;
  readonly onOpenMenu: (comment: ItemComment) => void;
}

/**
 * One comment as a line of the conversation (no card around it): the author's avatar - with a small
 * crown when they own the Collection (no 소유자 text; the screen reader hears it) - their nickname, the
 * time, and the text below. The text is plain text only: whatever was typed, never interpreted. A small
 * "..." opens the delete menu where the caller may delete it.
 */
export function CommentRow({ comment, canDelete, onOpenMenu }: CommentRowProps) {
  const { t } = useTranslation();
  const { author } = comment;
  const name = personLabel({ jupleId: author.jupleId, displayName: author.displayName });
  const time = formatCommentTime(comment.createdAtUtc, t);
  return (
    <View
      accessibilityLabel={`${author.isCollectionOwner ? t('comments.ownerA11y', { name }) : name}, ${time}. ${comment.body}`}
      accessible
      style={styles.row}
      testID={`comment-${comment.id}`}
    >
      <UserAvatar
        displayName={author.displayName}
        imageUrl={author.profileImageUrl}
        imageVersion={author.profileImageVersion}
        jupleId={author.jupleId}
        size={AVATAR_SIZE}
      />
      <View style={styles.main}>
        <View style={styles.meta}>
          {author.isCollectionOwner ? <CrownIcon color={colors.warning} size={13} /> : null}
          <Text numberOfLines={1} style={styles.name}>{name}</Text>
          <Text numberOfLines={1} style={styles.time}>{time}</Text>
        </View>
        {/* Plain text, nothing parsed: no links, no markup. Long unbroken text wraps instead of overflowing. */}
        <Text selectable style={styles.body} testID={`comment-body-${comment.id}`}>{comment.body}</Text>
      </View>
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
    </View>
  );
}

const styles = StyleSheet.create({
  row: { alignItems: 'flex-start', columnGap: spacing.sm, flexDirection: 'row', paddingVertical: spacing.sm },
  main: { flex: 1, minWidth: 0 },
  meta: { alignItems: 'center', columnGap: spacing.xs, flexDirection: 'row' },
  name: { color: colors.textPrimary, flexShrink: 1, fontSize: 13, fontWeight: '700' },
  time: { color: colors.textSecondary, flexShrink: 0, fontSize: 12 },
  body: { color: colors.textPrimary, fontSize: 14, lineHeight: 20, marginTop: 2 },
  // 44dp to touch, a quiet three-dot glyph to look at.
  more: { alignItems: 'center', height: minTouchTarget - 8, justifyContent: 'center', marginEnd: -spacing.xs, width: minTouchTarget - 8 },
});
