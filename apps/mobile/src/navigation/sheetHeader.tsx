import { useTheme as useNavigationTheme } from '@react-navigation/native';
import type { NativeStackHeaderProps, NativeStackNavigationOptions } from '@react-navigation/native-stack';
import type { ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import { Platform, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Pressable } from '../components/Pressable';
import { BackArrowIcon } from '../icons/BackArrowIcon';
import { minTouchTarget, spacing, themedStyles } from '../theme/tokens';

/**
 * The iOS header's layout, like the Android toolbar: the arrow's ink on the content edge (24pt: this inset plus the glyph's own
 * side bearing), the title after it with the Android toolbar's gap (Android: arrow 16..40dp, title at 72dp).
 */
const IOS_BAR_LEADING_INSET = 20;
const IOS_BAR_TRAILING_INSET = 24;
/** Row height, the room under it, and the room a page sheet leaves above it (no status bar inset there): the system bar's metrics. */
const IOS_BAR_ROW_HEIGHT = minTouchTarget;
const IOS_BAR_BOTTOM_PADDING = 10;
const IOS_SHEET_TOP_PADDING = 20;
const ARROW_SIZE = 24;
const ARROW_TO_TITLE_GAP = 32;
/**
 * The compact bar (a Collection: arrow, then its icon tile and name): the arrow glyph's ink ends 4pt inside its 24pt box, so 16pt
 * here leaves ~20pt of air between the arrow and the tile - the same as between the Collection's own toolbar icons (favorite, share)
 * - instead of the toolbar-title rhythm above. The arrow's touch area (ARROW_HIT_SLOP) still ends where the title starts.
 */
const COMPACT_ARROW_TO_TITLE_GAP = 16;
/**
 * The arrow's control is a minTouchTarget square centred on the glyph (so its press shows as a circle around the arrow, like the
 * other icon buttons); this pulls it back by the extra width on each side, so the glyph, the title after it and the touch area
 * (with ARROW_HIT_SLOP) stay exactly where they were with a glyph-wide control.
 */
const ARROW_SQUARE_INSET = (minTouchTarget - ARROW_SIZE) / 2;
/** The same touch area as before: 16pt beyond the glyph on each side, 10pt above and below. */
const ARROW_HIT_SLOP = { top: 10, bottom: 10, left: 16 - ARROW_SQUARE_INSET, right: 16 - ARROW_SQUARE_INSET };

/**
 * The header of every stack screen on iOS, drawn inside the screen (native-stack's `header` option) instead of in the system
 * navigation bar. The system bar animates its items separately from the screen, and since iOS 26 they re-accelerate just before
 * landing while the content is already settling - measured frame by frame, with custom items and with a purely native bar alike,
 * and seen as a shake at the end of every push. Inside the screen the header moves with it, as one piece. The transition itself,
 * the edge swipe back and the sheet's swipe down stay native (react-native-screens decides them from `gestureEnabled`).
 */
function IosStackHeader({ back, navigation, options, titleElement, compact = false }: NativeStackHeaderProps & { readonly titleElement?: ReactElement; readonly compact?: boolean }) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const { colors: navigationColors } = useNavigationTheme();
  const canGoBack = back !== undefined;
  const tintColor = options.headerTintColor ?? navigationColors.primary;
  const isSheet = options.presentation === 'modal' || options.presentation === 'formSheet' || options.presentation === 'pageSheet';
  const right = options.headerRight?.({ canGoBack, tintColor });
  return (
    <View
      style={[
        styles.bar,
        {
          backgroundColor: StyleSheet.flatten(options.headerStyle)?.backgroundColor ?? navigationColors.card,
          borderBottomColor: navigationColors.border,
          // A screen that sits on one flat surface with its content (headerShadowVisible: false) draws no line under the bar.
          borderBottomWidth: options.headerShadowVisible === false ? 0 : StyleSheet.hairlineWidth,
          paddingTop: isSheet ? IOS_SHEET_TOP_PADDING : insets.top,
          // A flat-plane screen (headerShadowVisible: false) lets its content start right under the row.
          ...(options.headerShadowVisible === false ? { paddingBottom: 0 } : null),
        },
      ]}
      testID="ios-stack-header"
    >
      <View style={styles.row}>
        {canGoBack ? (
          <Pressable
            accessibilityLabel={t('common.back')}
            accessibilityRole="button"
            hitSlop={ARROW_HIT_SLOP}
            onPress={() => navigation.goBack()}
            style={styles.arrow}
            testID="header-back"
          >
            <BackArrowIcon color={tintColor} size={ARROW_SIZE} />
          </Pressable>
        ) : null}
        <View style={[styles.title, canGoBack && (compact ? styles.titleAfterArrowCompact : styles.titleAfterArrow)]}>
          {titleElement ?? (
            <Text accessibilityRole="header" numberOfLines={1} style={[styles.titleText, { color: navigationColors.text }]}>{options.title}</Text>
          )}
        </View>
        {right ? <View style={styles.right}>{right}</View> : null}
      </View>
    </View>
  );
}

/**
 * The default header of the root stack on iOS (a screen's plain `title`). Android keeps its own native header and system back, so
 * nothing is set there.
 */
export function iosHeaderOptions(): NativeStackNavigationOptions {
  if (Platform.OS !== 'ios') {
    return {};
  }
  return { header: props => <IosStackHeader {...props} /> };
}

/**
 * A titled stack screen's header on iOS: the [arrow] [icon] Title row, left-aligned like Android. compact: the in-screen bar of a
 * screen whose title is an icon tile (a Collection) - the title follows the arrow at the toolbar icons' spacing.
 */
export function iosLeadingTitleOptions(title: ReactElement, compact = false): NativeStackNavigationOptions {
  return { header: props => <IosStackHeader {...props} compact={compact} titleElement={title} /> };
}

const styles = themedStyles(() => ({
  // The border is inside the bar's height, so the content below starts exactly where it did under the system bar.
  bar: { borderBottomWidth: StyleSheet.hairlineWidth, paddingBottom: IOS_BAR_BOTTOM_PADDING - StyleSheet.hairlineWidth },
  row: { alignItems: 'center', flexDirection: 'row', minHeight: IOS_BAR_ROW_HEIGHT, paddingEnd: IOS_BAR_TRAILING_INSET, paddingStart: IOS_BAR_LEADING_INSET },
  // The glyph starts exactly on the content edge: the square control reaches ARROW_SQUARE_INSET past it on both sides.
  arrow: {
    alignItems: 'center',
    height: minTouchTarget,
    justifyContent: 'center',
    marginEnd: -ARROW_SQUARE_INSET,
    marginStart: -ARROW_SQUARE_INSET,
    width: minTouchTarget,
  },
  title: { flex: 1, minWidth: 0 },
  titleAfterArrow: { marginStart: ARROW_TO_TITLE_GAP },
  titleAfterArrowCompact: { marginStart: COMPACT_ARROW_TO_TITLE_GAP },
  titleText: { fontSize: 17, fontWeight: '600' },
  right: { flexShrink: 0, marginStart: spacing.sm },
}));
