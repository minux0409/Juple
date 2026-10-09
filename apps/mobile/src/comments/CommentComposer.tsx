import { type ElementRef, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { CloseIcon } from '../icons/CloseIcon';
import { colors, minTouchTarget, radii, spacing } from '../theme/tokens';
import { MAX_COMMENT_LENGTH } from './commentsApi';
import type { EditTarget, ReplyTarget } from './useItemComments';

/** About four lines of the input's own text before it scrolls instead of growing. */
const LINE_HEIGHT = 20;
const MAX_VISIBLE_LINES = 4;
const MAX_INPUT_HEIGHT = LINE_HEIGHT * MAX_VISIBLE_LINES + spacing.sm * 2;

interface CommentComposerProps {
  readonly isSending: boolean;
  /** Sends the text; resolves true when it was sent (the input is then cleared), false when it was not (the text stays). */
  readonly onSubmit: (body: string) => Promise<boolean>;
  /** Set while the caller is answering a comment: the composer says whom and offers to stop. */
  readonly replyTarget?: ReplyTarget | null;
  readonly onCancelReply?: () => void;
  /**
   * Set while the caller edits one of their own comments: the field holds its words, the bar says "댓글 수정" with an X, and the
   * action reads 수정 (off until the text really changed). onSubmit then saves the edit. Only the words are editable - the
   * answered person of a reply is metadata and never part of this text.
   */
  readonly editTarget?: EditTarget | null;
  readonly onCancelEdit?: () => void;
}

/**
 * The comment field at the bottom of the link's screen: multiline, at most 1000 characters, growing to
 * about four lines. 전송 is off while the text is empty or only whitespace and while a send is on its
 * way (so a double tap never sends twice); the text is trimmed when sent. A failed send keeps what was
 * typed so it can be sent again.
 *
 * Reply mode ("OO님에게 답글" with an X above the field): starting an answer focuses the field. The field itself
 * stays exactly what the person writes - nothing is put into it; the answered person is shown by the bar above and
 * (once sent) rendered from the server's reply target, and which comment is answered is the reply target's id alone.
 * A typed "@name" is just text and never decides whom the reply goes to.
 */
export function CommentComposer({ isSending, onSubmit, replyTarget = null, onCancelReply, editTarget = null, onCancelEdit }: CommentComposerProps) {
  const { t } = useTranslation();
  const [text, setText] = useState('');
  const inputRef = useRef<ElementRef<typeof TextInput>>(null);
  const trimmed = text.trim();
  const canSend = trimmed.length > 0 && !isSending && (editTarget === null || trimmed !== editTarget.body.trim());
  const targetId = replyTarget?.commentId ?? null;
  const editId = editTarget?.commentId ?? null;
  const editBody = editTarget?.body ?? '';
  const previousEditIdRef = useRef<number | null>(null);

  useEffect(() => {
    if (targetId !== null) {
      inputRef.current?.focus();
    }
  }, [targetId]);

  // Starting an edit puts the comment's words into the field; leaving edit mode (cancel, or saved) empties it again.
  useEffect(() => {
    if (editId !== null) {
      setText(editBody);
      inputRef.current?.focus();
    } else if (previousEditIdRef.current !== null) {
      setText('');
    }
    previousEditIdRef.current = editId;
    // editBody is the words at the moment editing started; a re-render with the same comment must not reset what was typed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editId]);

  const send = async () => {
    if (!canSend) {
      return;
    }
    if (await onSubmit(trimmed)) {
      setText('');
    }
  };

  return (
    <View style={styles.wrapper} testID="comment-composer">
      {editTarget ? (
        <View style={styles.replyBar} testID="comment-edit-bar">
          <Text numberOfLines={1} style={styles.replyText}>{t('comments.editing')}</Text>
          <Pressable
            accessibilityLabel={t('comments.cancelEdit')}
            accessibilityRole="button"
            hitSlop={8}
            onPress={onCancelEdit}
            style={styles.replyCancel}
            testID="comment-edit-cancel"
          >
            <CloseIcon color={colors.textSecondary} size={16} />
          </Pressable>
        </View>
      ) : null}
      {replyTarget && !editTarget ? (
        <View style={styles.replyBar} testID="comment-reply-bar">
          <Text numberOfLines={1} style={styles.replyText}>{t('comments.replyingTo', { name: replyTarget.name })}</Text>
          <Pressable
            accessibilityLabel={t('comments.cancelReply')}
            accessibilityRole="button"
            hitSlop={8}
            onPress={onCancelReply}
            style={styles.replyCancel}
            testID="comment-reply-cancel"
          >
            <CloseIcon color={colors.textSecondary} size={16} />
          </Pressable>
        </View>
      ) : null}
      <View style={styles.bar}>
      <TextInput
        accessibilityLabel={replyTarget ? t('comments.replyPlaceholder') : t('comments.placeholder')}
        editable={!isSending}
        maxLength={MAX_COMMENT_LENGTH}
        multiline
        onChangeText={setText}
        placeholder={replyTarget ? t('comments.replyPlaceholder') : t('comments.placeholder')}
        placeholderTextColor={colors.textSecondary}
        ref={inputRef}
        style={styles.input}
        testID="comment-input"
        textAlignVertical="top"
        value={text}
      />
      <Pressable
        accessibilityLabel={editTarget ? t('comments.editSave') : t('comments.send')}
        accessibilityRole="button"
        accessibilityState={{ busy: isSending, disabled: !canSend }}
        disabled={!canSend}
        onPress={() => {
          send().catch(() => undefined);
        }}
        style={[styles.send, !canSend && styles.sendDisabled]}
        testID="comment-send"
      >
        {isSending ? <ActivityIndicator color={colors.surface} size="small" /> : <Text numberOfLines={1} style={styles.sendLabel}>{editTarget ? t('comments.editSave') : t('comments.send')}</Text>}
      </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: { backgroundColor: colors.surface, borderTopColor: colors.divider, borderTopWidth: 1 },
  replyBar: {
    alignItems: 'center',
    backgroundColor: colors.surfaceMuted,
    columnGap: spacing.sm,
    flexDirection: 'row',
    paddingStart: spacing.lg,
    paddingEnd: spacing.sm,
  },
  replyText: { color: colors.textSecondary, flex: 1, fontSize: 13, fontWeight: '600' },
  replyCancel: { alignItems: 'center', height: minTouchTarget, justifyContent: 'center', width: minTouchTarget },
  bar: {
    alignItems: 'flex-end',
    columnGap: spacing.sm,
    flexDirection: 'row',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  input: {
    backgroundColor: colors.surfaceMuted,
    borderRadius: radii.md,
    color: colors.textPrimary,
    flex: 1,
    fontSize: 14,
    lineHeight: LINE_HEIGHT,
    maxHeight: MAX_INPUT_HEIGHT,
    minHeight: minTouchTarget,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  send: {
    alignItems: 'center',
    backgroundColor: colors.brand,
    borderRadius: radii.md,
    justifyContent: 'center',
    minHeight: minTouchTarget,
    minWidth: minTouchTarget + 16,
    paddingHorizontal: spacing.md,
  },
  sendDisabled: { opacity: 0.4 },
  sendLabel: { color: colors.surface, fontSize: 14, fontWeight: '700' },
});
