import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { personLabel } from '../collections/api/collaborationApi';
import { UserAvatar } from '../components/UserAvatar';
import { CrownIcon } from '../icons/CrownIcon';
import { HeartIcon } from '../icons/HeartIcon';
import { colors, minTouchTarget, spacing } from '../theme/tokens';
import type { ItemComment } from './commentsApi';
import { formatCommentTime } from './formatCommentTime';
import { stripLegacyReplyMention } from './replyMention';

const AVATAR_SIZE = 28;
const REPLY_AVATAR_SIZE = 24;
/** Replies of every depth sit under the top-level comment at this ONE indent - the avatar column plus its gap. */
export const REPLY_INDENT = AVATAR_SIZE + spacing.sm;
/** How far the 44dp touch boxes of the action line reach up over the body's bottom slack (14dp above the label minus a ~5dp visual gap). */
export const REPLY_ACTION_OVERLAP = 10;
/** The small invisible margin that makes the avatar and the name easy to hit without taking any room. */
/** The heart's column on the right edge: wide enough for its 44dp touch target, so the text never runs under it. */
const HEART_COLUMN_WIDTH = minTouchTarget;
const PROFILE_HIT_SLOP = { top: 8, bottom: 8, left: 6, right: 6 } as const;

interface CommentRowProps {
  readonly comment: ItemComment;
  /**
   * Long-press on the comment: its action menu (수정하기 / 삭제하기). Pass it ONLY when the caller may do at least one of those -
   * a comment nobody may change has no long-press and no empty menu.
   */
  readonly onLongPress?: (comment: ItemComment) => void;
  /** Tap on the avatar or the name: the author's profile. Without it they are plain, untappable. */
  readonly onOpenProfile?: (comment: ItemComment) => void;
  /** Starts an answer to this comment (top-level or reply). Without it the row shows no 답글 달기. */
  readonly onReply?: (comment: ItemComment) => void;
  /** Hearts / un-hearts it. Without it the row shows no heart. */
  readonly onToggleLike?: (comment: ItemComment) => void;
  /** A reply inside a thread: one indent level (never deeper), a smaller avatar. */
  readonly isReply?: boolean;
}

/**
 * One comment as a line of the conversation (no card around it), laid out like the reference apps do:
 *
 *   [avatar]  nickname  time                    ♡
 *             the text                          12
 *             답글 달기
 *
 * The author's avatar - with a small crown when they own the Collection (no 소유자 text; the screen reader hears it) - their
 * nickname, the time and the text fill the row; 답글 달기 sits under the text on the left; the heart with its number sits on the
 * RIGHT edge of the same row, in a narrow fixed column that only ever holds the heart (there is no "..." and no stack of
 * buttons), so long text wraps before it and the heart never decides how tall the row is. The text is plain text only:
 * whatever was typed, never interpreted. A reply to another reply starts with the answered person's name ("@name", from the
 * server's reply target - never parsed out of the text, shown once).
 *
 * Gestures stay separate: the avatar and the name open the author's profile, the heart and 답글 달기 do their own thing,
 * and a long-press anywhere else on the comment opens its action menu - only when the caller may edit or delete it.
 * A deleted comment that others answered is only "삭제된 댓글입니다." - nothing of the person or the words.
 */
export function CommentRow({ comment, onLongPress, onOpenProfile, onReply, onToggleLike, isReply = false }: CommentRowProps) {
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
  const replyToName = comment.replyTo ? personLabel({ jupleId: comment.replyTo.jupleId, displayName: comment.replyTo.displayName }) : null;
  const mention = replyToName ? `@${replyToName}` : null;
  // The body is only what was written; the blue mention above comes from the reply target. Older replies stored the same
  // "@name " inside the body too - that one redundant lead is not shown twice.
  const body = stripLegacyReplyMention(comment.body, replyToName);
  const liked = comment.viewerLiked === true;
  const likeCount = comment.likeCount ?? 0;
  const openProfile = onOpenProfile ? () => onOpenProfile(comment) : undefined;
  const profileLabel = t('comments.profileA11y', { name });
  const avatar = (
    <UserAvatar
      displayName={author.displayName}
      imageUrl={author.profileImageUrl}
      imageVersion={author.profileImageVersion}
      jupleId={author.jupleId}
      size={isReply ? REPLY_AVATAR_SIZE : AVATAR_SIZE}
    />
  );

  return (
    // The row itself is not one accessible element (its controls must stay reachable); its long-press is offered to
    // assistive technology as an action on the text block below.
    <Pressable
      accessible={false}
      delayLongPress={350}
      onLongPress={onLongPress ? () => onLongPress(comment) : undefined}
      style={[styles.row, indentStyle]}
      testID={`comment-${comment.id}`}
    >
      {openProfile ? (
        <Pressable accessibilityLabel={profileLabel} accessibilityRole="button" hitSlop={PROFILE_HIT_SLOP} onPress={openProfile} testID={`comment-avatar-${comment.id}`}>
          {avatar}
        </Pressable>
      ) : avatar}
      <View style={styles.main}>
        <View
          accessibilityActions={onLongPress ? [{ name: 'options', label: t('comments.optionsA11y') }] : undefined}
          accessibilityLabel={`${author.isCollectionOwner ? t('comments.ownerA11y', { name }) : name}, ${time}. ${mention ? `${mention} ` : ''}${body}`}
          accessible
          onAccessibilityAction={onLongPress ? event => { if (event.nativeEvent.actionName === 'options') { onLongPress(comment); } } : undefined}
        >
          <View style={styles.meta}>
            {author.isCollectionOwner ? <CrownIcon color={colors.warning} size={13} /> : null}
            {openProfile ? (
              <Pressable accessibilityLabel={profileLabel} accessibilityRole="button" hitSlop={PROFILE_HIT_SLOP} onPress={openProfile} style={styles.nameButton} testID={`comment-author-${comment.id}`}>
                <Text numberOfLines={1} style={styles.name}>{name}</Text>
              </Pressable>
            ) : (
              <Text numberOfLines={1} style={[styles.name, styles.nameButton]}>{name}</Text>
            )}
            <Text numberOfLines={1} style={styles.time}>{time}</Text>
          </View>
          {/* Plain text, nothing parsed: no links, no markup. Long unbroken text wraps instead of overflowing. Selecting text would
              swallow the long-press that opens the menu, so a comment WITH a menu is not selectable. */}
          <Text selectable={!onLongPress} style={styles.body} testID={`comment-body-${comment.id}`}>
            {mention
              ? [<Text key="mention" style={styles.mention} testID={`comment-mention-${comment.id}`}>{`${mention} `}</Text>, body]
              : body}
          </Text>
        </View>
        {onReply ? (
          <View style={styles.actions} testID={`comment-actions-${comment.id}`}>
            <Pressable
              accessibilityRole="button"
              onPress={() => onReply(comment)}
              style={styles.replyAction}
              testID={`comment-reply-${comment.id}`}
            >
              <Text style={styles.replyLabel}>{t('comments.reply')}</Text>
            </Pressable>
          </View>
        ) : null}
      </View>
      {onToggleLike ? (
        <View style={styles.side} testID={`comment-side-${comment.id}`}>
          <Pressable
            accessibilityLabel={`${liked ? t('comments.unlike') : t('comments.like')}${likeCount > 0 ? `, ${t('comments.likeCountA11y', { count: likeCount })}` : ''}`}
            accessibilityRole="button"
            accessibilityState={{ selected: liked }}
            onPress={() => onToggleLike(comment)}
            style={styles.heart}
            testID={`comment-like-${comment.id}`}
          >
            <HeartIcon color={liked ? colors.danger : colors.textSecondary} filled={liked} size={16} />
            {likeCount > 0 ? <Text style={[styles.likeCount, liked && styles.likeCountOn]} testID={`comment-like-count-${comment.id}`}>{likeCount}</Text> : null}
          </Pressable>
        </View>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  // No bottom padding: the lower half of 답글 달기's 44dp touch box already is the room before the next comment.
  row: { alignItems: 'flex-start', columnGap: spacing.sm, flexDirection: 'row', paddingTop: spacing.sm - 2 },
  replyIndent: { marginStart: REPLY_INDENT },
  main: { flex: 1, minWidth: 0 },
  meta: { alignItems: 'center', columnGap: spacing.xs, flexDirection: 'row' },
  nameButton: { flexShrink: 1 },
  name: { color: colors.textPrimary, flexShrink: 1, fontSize: 13, fontWeight: '700' },
  time: { color: colors.textSecondary, flexShrink: 0, fontSize: 12 },
  body: { color: colors.textPrimary, fontSize: 14, lineHeight: 20, marginTop: 2 },
  mention: { color: colors.brand, fontWeight: '700' },
  // 답글 달기: its 44dp touch box is centred on the line and reaches up over the body's bottom slack, so the visible gap to the
  // body is a few dp. The lower half of the box is the room before the next comment.
  actions: { alignItems: 'center', flexDirection: 'row', marginTop: -REPLY_ACTION_OVERLAP },
  // The heart's own narrow column on the right edge: fixed width (the text wraps before it), pinned to the top of the row so it
  // sits beside the first lines of the text, and no taller than its 44dp touch target - 답글 달기 and the text decide the row's height.
  side: { alignSelf: 'flex-start', flexShrink: 0, marginTop: spacing.xs, width: HEART_COLUMN_WIDTH },
  heart: { alignItems: 'center', justifyContent: 'center', minHeight: minTouchTarget, minWidth: minTouchTarget, width: HEART_COLUMN_WIDTH },
  likeCount: { color: colors.textSecondary, fontSize: 12, marginTop: 1 },
  likeCountOn: { color: colors.danger },
  replyAction: { alignSelf: 'flex-start', justifyContent: 'center', minHeight: minTouchTarget, paddingEnd: spacing.md },
  replyLabel: { color: colors.textSecondary, fontSize: 12, fontWeight: '700' },
  deletedBox: { flex: 1, minHeight: minTouchTarget - 16, justifyContent: 'center' },
  deletedText: { color: colors.textSecondary, fontSize: 13, fontStyle: 'italic' },
});
