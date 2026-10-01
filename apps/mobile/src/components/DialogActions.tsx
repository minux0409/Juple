import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View, type TextLayoutEvent } from 'react-native';
import { colors, minTouchTarget, radii, spacing } from '../theme/tokens';

/** secondary: outlined (취소); destructive / neutral / brand: filled. */
export type DialogActionTone = 'secondary' | 'destructive' | 'neutral' | 'brand';

export interface DialogAction {
  readonly label: string;
  readonly onPress: () => void;
  readonly tone: DialogActionTone;
  readonly disabled?: boolean;
  /** Shows a spinner instead of the label (the button stays its size). */
  readonly busy?: boolean;
  readonly testID?: string;
}

/**
 * Side by side, a label may take up to this many lines - beyond that the pair is stacked instead,
 * so no label is ever squeezed into a tall, narrow column. Decided from the labels' real rendered
 * line count (onTextLayout), never from a character count, so it holds for every language,
 * font size and screen width.
 */
const MAX_LINES_SIDE_BY_SIDE = 2;

/**
 * The action buttons at the bottom of an app dialog (ConfirmDialog, the Collection editor): two
 * equal halves side by side, each label centered and free to wrap onto a second line; when a
 * label would need more than that (a long translation on a narrow screen), the buttons stack
 * full-width instead, in the same order. Every button keeps at least the 44dp touch target.
 */
export function DialogActions({ actions }: { readonly actions: readonly DialogAction[] }) {
  const [isStacked, setIsStacked] = useState(false);
  const labelsKey = actions.map(action => action.label).join('\u0000');

  // New labels (another language, another dialog content) get a fresh side-by-side attempt.
  useEffect(() => {
    setIsStacked(false);
  }, [labelsKey]);

  const measureLabel = (event: TextLayoutEvent) => {
    if (!isStacked && event.nativeEvent.lines.length > MAX_LINES_SIDE_BY_SIDE) {
      setIsStacked(true);
    }
  };

  return (
    <View style={[styles.row, isStacked && styles.stacked]} testID="dialog-actions">
      {actions.map((action, index) => {
        const filled = action.tone !== 'secondary';
        return (
          <Pressable
            accessibilityLabel={action.label}
            accessibilityRole="button"
            accessibilityState={{ disabled: action.disabled === true, busy: action.busy === true }}
            disabled={action.disabled}
            key={index}
            onPress={action.onPress}
            style={[
              styles.button,
              isStacked ? styles.buttonStacked : styles.buttonSideBySide,
              filled ? toneStyles[action.tone] : styles.secondary,
              action.disabled && filled && styles.disabled,
            ]}
            testID={action.testID}
          >
            {action.busy ? (
              <ActivityIndicator color={filled ? colors.surface : colors.textPrimary} size="small" />
            ) : (
              <Text onTextLayout={measureLabel} style={[styles.label, filled ? styles.labelFilled : styles.labelSecondary]}>
                {action.label}
              </Text>
            )}
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: spacing.sm },
  stacked: { flexDirection: 'column' },
  button: {
    alignItems: 'center',
    borderRadius: radii.md,
    justifyContent: 'center',
    minHeight: minTouchTarget,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 4,
  },
  // Equal halves: flexBasis 0 so a longer label never makes its own button wider than the other.
  buttonSideBySide: { flexBasis: 0, flexGrow: 1, flexShrink: 1, minWidth: 0 },
  buttonStacked: { alignSelf: 'stretch' },
  secondary: { borderColor: colors.border, borderWidth: 1 },
  disabled: { opacity: 0.5 },
  label: { fontSize: 16, fontWeight: '600', textAlign: 'center' },
  labelSecondary: { color: colors.textPrimary },
  labelFilled: { color: colors.surface },
});

const toneStyles = StyleSheet.create({
  destructive: { backgroundColor: colors.danger },
  neutral: { backgroundColor: colors.textPrimary },
  brand: { backgroundColor: colors.brand },
});
