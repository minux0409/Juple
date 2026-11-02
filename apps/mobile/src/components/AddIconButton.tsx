import { forwardRef, type ComponentRef } from 'react';
import type { PressableProps } from 'react-native';
import { Pressable } from './Pressable';
import { PlusIcon } from '../icons/PlusIcon';
import { useTheme } from '../theme/ThemeContext';
import { colors, minTouchTarget, radii, themedStyles } from '../theme/tokens';

/** The same filled, rounded add control in Collection and native-stack Friend headers. */
export const AddIconButton = forwardRef<ComponentRef<typeof Pressable>, Omit<PressableProps, 'children' | 'style'>>(
  function SharedAddIconButton(props, ref) {
    useTheme();
    return <Pressable {...props} accessibilityRole="button" ref={ref} style={styles.button}>
      <PlusIcon color={colors.onBrand} size={20} strokeWidth={2.25} />
    </Pressable>;
  },
);

const styles = themedStyles(() => ({
  button: { alignItems: 'center', backgroundColor: colors.brand, borderRadius: radii.md + 4, height: minTouchTarget, justifyContent: 'center', width: minTouchTarget },
}));
