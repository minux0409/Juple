import { forwardRef, type ComponentRef } from 'react';
import type { PressableProps } from 'react-native';
import { Pressable } from './Pressable';
import { PlusIcon } from '../icons/PlusIcon';
import { useTheme } from '../theme/ThemeContext';
import { colors, minTouchTarget, radii, themedStyles } from '../theme/tokens';

/** The same filled, rounded add control in Collection and native-stack Friend headers. */
/**
 * `compact` is for a button that sits in a root tab's title row (Collections): it is no taller than the title text, so the row keeps
 * the height of the other tabs' title rows, and its touch area is still minTouchTarget through hitSlop.
 */
export const AddIconButton = forwardRef<ComponentRef<typeof Pressable>, Omit<PressableProps, 'children' | 'style'> & { readonly compact?: boolean }>(
  function SharedAddIconButton({ compact = false, ...props }, ref) {
    useTheme();
    return <Pressable {...props} accessibilityRole="button" hitSlop={compact ? COMPACT_HIT_SLOP : props.hitSlop} ref={ref} style={compact ? styles.compactButton : styles.button}>
      <PlusIcon color={colors.onBrand} size={compact ? 16 : 20} strokeWidth={2.25} />
    </Pressable>;
  },
);

/** 28dp control + 8dp each side = the 44dp minimum touch target. */
const COMPACT_SIZE = 28;
const COMPACT_HIT_SLOP = { top: 8, bottom: 8, left: 8, right: 8 };

const styles = themedStyles(() => ({
  compactButton: { alignItems: 'center', backgroundColor: colors.brand, borderRadius: radii.md, height: COMPACT_SIZE, justifyContent: 'center', width: COMPACT_SIZE },
  button: { alignItems: 'center', backgroundColor: colors.brand, borderRadius: radii.md + 4, height: minTouchTarget, justifyContent: 'center', width: minTouchTarget },
}));
