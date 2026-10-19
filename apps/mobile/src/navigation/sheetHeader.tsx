import type { NativeStackNavigationOptions } from '@react-navigation/native-stack';
import { useTranslation } from 'react-i18next';
import { Platform, Pressable } from 'react-native';
import { BackArrowIcon } from '../icons/BackArrowIcon';
import { colors, minTouchTarget, themedStyles } from '../theme/tokens';

function HeaderBackButton({ color, onPress }: { readonly color: string; readonly onPress: () => void }) {
  const { t } = useTranslation();
  return (
    <Pressable accessibilityLabel={t('common.back')} accessibilityRole="button" hitSlop={4} onPress={onPress} style={styles.button} testID="header-back">
      <BackArrowIcon color={color} size={24} />
    </Pressable>
  );
}

/**
 * The iOS header's back control, set once as the root stack's screenOptions: the Android arrow alone - no previous screen's
 * title ("MainTabs", a route name) and no iOS 26 glass capsule around it - on every pushed screen and on the page sheet
 * (`presentation: 'modal'`, e.g. 공유), which has no back button of its own on iOS. The edge swipe back and the sheet's swipe
 * down keep working (react-native-screens decides them from `gestureEnabled`, not from the bar button). Android keeps its own
 * native header arrow and system back, so nothing is set there.
 */
export function iosHeaderBackOptions(goBack: () => void): NativeStackNavigationOptions {
  if (Platform.OS !== 'ios') {
    return {};
  }
  return {
    headerBackVisible: false,
    unstable_headerLeftItems: ({ canGoBack, tintColor }) =>
      canGoBack
        ? [{ type: 'custom', hidesSharedBackground: true, element: <HeaderBackButton color={tintColor ?? colors.textPrimary} onPress={goBack} /> }]
        : [],
  };
}

const styles = themedStyles(() => ({
  button: { alignItems: 'center', height: minTouchTarget, justifyContent: 'center', width: minTouchTarget },
}));
