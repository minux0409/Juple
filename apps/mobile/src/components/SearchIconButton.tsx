import { ActivityIndicator, Pressable, StyleSheet } from 'react-native';
import { SearchIcon } from '../icons/SearchIcon';
import { colors, minTouchTarget, radii } from '../theme/tokens';

interface SearchIconButtonProps {
  /** What the button does, for assistive technology (e.g. 찾기) - the icon alone says nothing to a screen reader. */
  readonly accessibilityLabel: string;
  readonly onPress: () => void;
  readonly disabled?: boolean;
  /** Replaces the magnifier with a spinner while the lookup runs; the button stays the same size. */
  readonly isLoading?: boolean;
  readonly testID?: string;
}

/**
 * The magnifying-glass action button (an ID lookup's 찾기): a 44dp bordered square next to its input,
 * the same shape the text button had, so the row does not change size between locales.
 */
export function SearchIconButton({ accessibilityLabel, onPress, disabled = false, isLoading = false, testID }: SearchIconButtonProps) {
  return (
    <Pressable
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="button"
      accessibilityState={{ disabled: disabled || isLoading, busy: isLoading }}
      disabled={disabled || isLoading}
      onPress={onPress}
      style={[styles.button, disabled && !isLoading && styles.disabled]}
      testID={testID}
    >
      {isLoading ? <ActivityIndicator size="small" /> : <SearchIcon color={colors.textPrimary} size={20} />}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    alignItems: 'center',
    borderColor: colors.border,
    borderRadius: radii.md,
    borderWidth: 1,
    flexShrink: 0,
    height: minTouchTarget,
    justifyContent: 'center',
    width: minTouchTarget,
  },
  disabled: { opacity: 0.45 },
});
