import { ActivityIndicator } from 'react-native';
import { Pressable } from './Pressable';
import { SearchIcon } from '../icons/SearchIcon';
import { colors, minTouchTarget, radii, themedStyles } from '../theme/tokens';

interface SearchIconButtonProps {
  /** What the button does, for assistive technology (e.g. 찾기) - the icon alone says nothing to a screen reader. */
  readonly accessibilityLabel: string;
  readonly onPress: () => void;
  readonly disabled?: boolean;
  /** Replaces the magnifier with a spinner while the lookup runs; the button stays the same size and cannot be pressed again. */
  readonly isLoading?: boolean;
  readonly testID?: string;
}

/**
 * The magnifying-glass action button (an ID lookup's 찾기): a 44dp square next to its input, the same shape the text button had, so
 * the row does not change size between locales. Its state is in its colours, not in a faded copy of the active look:
 * - nothing to look up yet (empty field): a quiet neutral square - muted fill, soft border, light icon;
 * - ready: the brand fill with the icon on it, like every other primary action;
 * - looking up: the same brand square with a spinner - it cannot start a second lookup.
 */
export function SearchIconButton({ accessibilityLabel, onPress, disabled = false, isLoading = false, testID }: SearchIconButtonProps) {
  const isIdle = disabled && !isLoading;
  return (
    <Pressable
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="button"
      accessibilityState={{ disabled: disabled || isLoading, busy: isLoading }}
      disabled={disabled || isLoading}
      onPress={onPress}
      style={({ pressed }) => [styles.button, isIdle ? styles.idle : styles.ready, pressed && styles.pressed]}
      testID={testID}
    >
      {isLoading ? (
        <ActivityIndicator color={colors.onBrand} size="small" />
      ) : (
        <SearchIcon color={isIdle ? colors.placeholder : colors.onBrand} size={20} />
      )}
    </Pressable>
  );
}

const styles = themedStyles(() => ({
  button: {
    alignItems: 'center',
    borderRadius: radii.md,
    borderWidth: 1,
    flexShrink: 0,
    height: minTouchTarget,
    justifyContent: 'center',
    width: minTouchTarget,
  },
  idle: { backgroundColor: colors.surfaceMuted, borderColor: colors.inputBorder },
  ready: { backgroundColor: colors.brand, borderColor: colors.brand },
  pressed: { opacity: 0.8 },
}));
