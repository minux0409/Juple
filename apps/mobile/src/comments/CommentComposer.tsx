import { type ElementRef, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { CloseIcon } from '../icons/CloseIcon';
import { colors, minTouchTarget, radii, spacing } from '../theme/tokens';
import { MAX_COMMENT_LENGTH } from './commentsApi';
import type { ReplyTarget } from './useItemComments';

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
}

/**
 * The comment field at the bottom of the link's screen: multiline, at most 1000 characters, growing to
 * about four lines. 전송 is off while the text is empty or only whitespace and while a send is on its
 * way (so a double tap never sends twice); the text is trimmed when sent. A failed send keeps what was
 * typed so it can be sent again.
 *
 * Reply mode ("OO님에게 답글" with an X above the field): starting an answer focuses the field; an answer to another
 * REPLY starts the text with "@name ". That mention is only text - which comment is answered is the reply target's id,
 * so editing or deleting the mention changes nothing about whom the reply goes to.
 */
export function CommentComposer({ isSending, onSubmit, replyTarget = null, onCancelReply }: CommentComposerProps) {
  const { t } = useTranslation();
  const [text, setText] = useState('');
  const inputRef = useRef<ElementRef<typeof TextInput>>(null);
  const prefilledRef = useRef<string | null>(null);
  const trimmed = text.trim();
  // The mention put in by reply mode is not a comment by itself.
  const isOnlyThePrefill = prefilledRef.current !== null && trimmed === prefilledRef.current.trim();
  const canSend = trimmed.length > 0 && !isOnlyThePrefill && !isSending;
  const targetId = replyTarget?.commentId ?? null;
  const targetMention = replyTarget?.mention ?? null;

  useEffect(() => {
    if (targetId === null) {
      // Stopped answering: drop a mention nobody typed past.
      setText(current => (prefilledRef.current !== null && current === prefilledRef.current ? '' : current));
      prefilledRef.current = null;
      return;
    }
    const prefill = targetMention ? `${targetMention} ` : null;
    setText(current => (current === '' || current === prefilledRef.current ? prefill ?? '' : current));
    prefilledRef.current = prefill;
    inputRef.current?.focus();
  }, [targetId, targetMention]);

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
      {replyTarget ? (
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
        accessibilityLabel={t('comments.send')}
        accessibilityRole="button"
        accessibilityState={{ busy: isSending, disabled: !canSend }}
        disabled={!canSend}
        onPress={() => {
          send().catch(() => undefined);
        }}
        style={[styles.send, !canSend && styles.sendDisabled]}
        testID="comment-send"
      >
        {isSending ? <ActivityIndicator color={colors.surface} size="small" /> : <Text numberOfLines={1} style={styles.sendLabel}>{t('comments.send')}</Text>}
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
