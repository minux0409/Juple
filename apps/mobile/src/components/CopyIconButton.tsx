import Clipboard from '@react-native-clipboard/clipboard';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet } from 'react-native';
import { CheckIcon } from '../icons/CheckIcon';
import { CopyIcon } from '../icons/CopyIcon';
import { colors, minTouchTarget } from '../theme/tokens';

/** How long the check mark stays after a copy. */
const COPIED_FEEDBACK_MS = 1500;

interface CopyIconButtonProps {
  /** Exactly what lands on the clipboard. */
  readonly text: string;
  readonly accessibilityLabel: string;
  readonly testID?: string;
  readonly size?: number;
}

/**
 * A small copy icon that writes `text` to the OS clipboard. Feedback is the one the Profile's Juple ID
 * copy uses: no toast of its own (Android 13+ already shows its "copied" message for every clipboard
 * write, and a second app-made one only doubled it) - the icon turns into a check for a moment instead.
 */
export function CopyIconButton({ text, accessibilityLabel, testID, size = 18 }: CopyIconButtonProps) {
  const [isCopied, setIsCopied] = useState(false);
  useEffect(() => {
    if (!isCopied) {
      return undefined;
    }
    const timeout = setTimeout(() => setIsCopied(false), COPIED_FEEDBACK_MS);
    return () => clearTimeout(timeout);
  }, [isCopied]);

  return (
    <Pressable
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="button"
      hitSlop={4}
      onPress={() => {
        Clipboard.setString(text);
        setIsCopied(true);
      }}
      style={({ pressed }) => [styles.button, pressed && styles.pressed]}
      testID={testID}
    >
      {isCopied ? <CheckIcon color={colors.brand} size={size} /> : <CopyIcon color={colors.textSecondary} size={size} />}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: { alignItems: 'center', height: minTouchTarget, justifyContent: 'center', width: minTouchTarget },
  pressed: { opacity: 0.6 },
});
