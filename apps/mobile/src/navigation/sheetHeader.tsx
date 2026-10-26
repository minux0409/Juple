import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationOptions } from '@react-navigation/native-stack';
import type { ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import { Platform, Pressable, View, useWindowDimensions } from 'react-native';
import { BackArrowIcon } from '../icons/BackArrowIcon';
import { colors, minTouchTarget, spacing, themedStyles } from '../theme/tokens';

function HeaderBackButton({ color, onPress }: { readonly color: string; readonly onPress: () => void }) {
  const { t } = useTranslation();
  return (
    <Pressable
      accessibilityLabel={t('common.back')}
      accessibilityRole="button"
      hitSlop={{ top: 10, bottom: 10, left: 16, right: 16 }}
      onPress={onPress}
      style={styles.arrow}
      testID="header-back"
    >
      <BackArrowIcon color={color} size={ARROW_SIZE} />
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

/**
 * The iOS header laid out like the Android toolbar: the arrow is the bar's first item, which the iOS bar places on its leading inset
 * (IOS_BAR_LEADING_INSET, measured on iOS 27 - the same 24pt edge the screens' content starts at), and the title follows it with the
 * Android toolbar's gap between the arrow and the title (Android: arrow 16..40dp, title at 72dp).
 */
const IOS_BAR_LEADING_INSET = 24;
const ARROW_SIZE = 24;
const ARROW_TO_TITLE_GAP = 32;

/** iOS: the back arrow and the screen's title together as the bar's leading item - left-aligned like Android, never centered. */
function HeaderBackAndTitle({ canGoBack, color, title }: { readonly canGoBack: boolean; readonly color: string; readonly title: ReactElement }) {
  const { t } = useTranslation();
  const navigation = useNavigation();
  const { width } = useWindowDimensions();
  return (
    // Bounded so a long title wraps or shrinks before it reaches a right-side header action.
    <View style={[styles.leading, { maxWidth: width - IOS_BAR_LEADING_INSET - 2 * minTouchTarget - spacing.lg }]} testID="header-leading">
      {canGoBack ? (
        <Pressable
          accessibilityLabel={t('common.back')}
          accessibilityRole="button"
          hitSlop={{ top: 10, bottom: 10, left: 16, right: 16 }}
          onPress={() => navigation.goBack()}
          style={styles.arrow}
          testID="header-back"
        >
          <BackArrowIcon color={color} size={ARROW_SIZE} />
        </Pressable>
      ) : null}
      <View style={[styles.title, canGoBack && styles.titleAfterArrow]}>{title}</View>
    </View>
  );
}

/**
 * A titled stack screen's header on iOS: the native (centered) title is left empty and the [arrow] [icon] Title row is the bar's
 * leading item instead, so every pushed screen and page sheet reads like Android - arrow on the content edge, title right after it.
 * The edge swipe back and the sheet's swipe down are untouched (react-native-screens decides them from `gestureEnabled`).
 */
export function iosLeadingTitleOptions(title: ReactElement): NativeStackNavigationOptions {
  return {
    headerTitle: '',
    headerBackVisible: false,
    unstable_headerLeftItems: ({ canGoBack, tintColor }) => [
      {
        type: 'custom',
        hidesSharedBackground: true,
        element: <HeaderBackAndTitle canGoBack={canGoBack === true} color={tintColor ?? colors.textPrimary} title={title} />,
      },
    ],
  };
}

const styles = themedStyles(() => ({
  leading: { alignItems: 'center', flexDirection: 'row', minHeight: minTouchTarget },
  // No side padding: the glyph starts exactly on the bar's leading inset (the content edge).
  arrow: { alignItems: 'center', height: minTouchTarget, justifyContent: 'center', width: ARROW_SIZE },
  title: { flexShrink: 1, minWidth: 0 },
  titleAfterArrow: { marginStart: ARROW_TO_TITLE_GAP },
}));
