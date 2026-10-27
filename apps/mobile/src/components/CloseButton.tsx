import { useTranslation } from 'react-i18next';
import { Pressable } from './Pressable';
import { CloseIcon } from '../icons/CloseIcon';
import { colors, minTouchTarget, themedStyles } from '../theme/tokens';

/**
 * The "just close this window" X for a sheet or dialog header: a 44dp target, the localized 닫기 as its accessible name, the theme's
 * secondary icon colour. Only for dismissing; abandoning an action is a 취소 button next to that action instead.
 */
export function CloseButton({ onPress, disabled, testID }: { readonly onPress: () => void; readonly disabled?: boolean; readonly testID?: string }) {
  const { t } = useTranslation();
  return (
    <Pressable accessibilityLabel={t('common.close')} accessibilityRole="button" accessibilityState={{ disabled: disabled === true }} disabled={disabled} hitSlop={4} onPress={onPress} style={styles.button} testID={testID}>
      <CloseIcon color={colors.textSecondary} size={20} />
    </Pressable>
  );
}

const styles = themedStyles(() => ({
  button: { alignItems: 'center', height: minTouchTarget, justifyContent: 'center', marginEnd: -8, width: minTouchTarget },
}));
