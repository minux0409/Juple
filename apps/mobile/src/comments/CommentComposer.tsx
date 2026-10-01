import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { colors, minTouchTarget, radii, spacing } from '../theme/tokens';
import { MAX_COMMENT_LENGTH } from './commentsApi';

/** About four lines of the input's own text before it scrolls instead of growing. */
const LINE_HEIGHT = 20;
const MAX_VISIBLE_LINES = 4;
const MAX_INPUT_HEIGHT = LINE_HEIGHT * MAX_VISIBLE_LINES + spacing.sm * 2;

interface CommentComposerProps {
  readonly isSending: boolean;
  /** Sends the text; resolves true when it was sent (the input is then cleared), false when it was not (the text stays). */
  readonly onSubmit: (body: string) => Promise<boolean>;
}

/**
 * The comment field at the bottom of the link's screen: multiline, at most 1000 characters, growing to
 * about four lines. 전송 is off while the text is empty or only whitespace and while a send is on its
 * way (so a double tap never sends twice); the text is trimmed when sent. A failed send keeps what was
 * typed so it can be sent again.
 */
export function CommentComposer({ isSending, onSubmit }: CommentComposerProps) {
  const { t } = useTranslation();
  const [text, setText] = useState('');
  const trimmed = text.trim();
  const canSend = trimmed.length > 0 && !isSending;

  const send = async () => {
    if (!canSend) {
      return;
    }
    if (await onSubmit(trimmed)) {
      setText('');
    }
  };

  return (
    <View style={styles.bar} testID="comment-composer">
      <TextInput
        accessibilityLabel={t('comments.placeholder')}
        editable={!isSending}
        maxLength={MAX_COMMENT_LENGTH}
        multiline
        onChangeText={setText}
        placeholder={t('comments.placeholder')}
        placeholderTextColor={colors.textSecondary}
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
  );
}

const styles = StyleSheet.create({
  bar: {
    alignItems: 'flex-end',
    backgroundColor: colors.surface,
    borderTopColor: colors.divider,
    borderTopWidth: 1,
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
