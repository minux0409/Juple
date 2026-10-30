import { useEffect, useState } from 'react';
import { ActivityIndicator, Text, View, type TextLayoutEvent } from 'react-native';
import { Pressable } from './Pressable';
import { colors, minTouchTarget, radii, spacing, themedStyles } from '../theme/tokens';

/** secondary: the quiet light-grey 취소; destructive (the J-red 삭제) / neutral / brand: filled. Every tone has the same size and shape. */
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
              <ActivityIndicator color={filled ? labelToneColor(action.tone) : colors.textPrimary} size="small" />
            ) : (
              <Text onTextLayout={measureLabel} style={[styles.label, filled ? labelToneStyles[action.tone] : styles.labelSecondary]}>
                {action.label}
              </Text>
            )}
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = themedStyles(() => ({
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
  // 취소: a light grey fill (no outline), dark neutral text - in Light and Dark the theme's muted surface.
  secondary: { backgroundColor: colors.surfaceMuted },
  disabled: { opacity: 0.5 },
  label: { fontSize: 16, fontWeight: '600', textAlign: 'center' },
  labelSecondary: { color: colors.textPrimary },
}));

/**
 * The label on a filled button: white on brand, white (bold) on the red delete fill (`destructive`, 4.8:1), the card colour on
 * the neutral (text-colour) fill.
 */
const labelToneStyles = themedStyles(() => ({
  destructive: { color: colors.onDestructive, fontWeight: '700' },
  neutral: { color: colors.surface },
  brand: { color: colors.onBrand },
  secondary: { color: colors.textPrimary },
}));

function labelToneColor(tone: DialogActionTone): string {
  return tone === 'destructive' ? colors.onDestructive : tone === 'brand' ? colors.onBrand : colors.surface;
}

const toneStyles = themedStyles(() => ({
  // Delete: the destructive red - the same colour as the swipe-to-delete underlay.
  destructive: { backgroundColor: colors.destructive },
  neutral: { backgroundColor: colors.textPrimary },
  brand: { backgroundColor: colors.brand },
}));
