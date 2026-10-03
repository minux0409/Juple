import type { ComponentType } from 'react';
import { StyleSheet, Text, View, type StyleProp, type TextStyle } from 'react-native';
import { colors, spacing } from '../theme/tokens';

export type ScreenTitleIcon = ComponentType<{ readonly color?: string; readonly size?: number }>;

/** One icon size and one icon-to-title gap for every screen title, so the navigation identity looks the same everywhere. */
export const SCREEN_TITLE_ICON_SIZE = 22;

interface ScreenTitleProps {
  /** The same icon the screen's tab / My Page row uses (see navigation/screenIcons). */
  readonly icon: ScreenTitleIcon;
  readonly title: string;
  readonly textStyle?: StyleProp<TextStyle>;
  readonly testID?: string;
}

/**
 * The navigation icon of a screen title on its own - for a header whose title text sits in a row of its
 * own (Home's 최근 저장 + count), where it goes before that row. Decoration only.
 */
export function ScreenTitleGlyph({ icon: Icon }: { readonly icon: ScreenTitleIcon }) {
  return (
    <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={styles.icon}>
      <Icon color={colors.brand} size={SCREEN_TITLE_ICON_SIZE} />
    </View>
  );
}

/**
 * A screen's title with its navigation icon before it: "[icon] Title" - on a root tab inside the
 * screen's own header, on a back-button screen as the stack header's title. The icon is decoration
 * (the title is what is announced); a long translation shrinks and wraps the text, never the icon.
 */
export function ScreenTitle({ icon, title, textStyle, testID }: ScreenTitleProps) {
  return (
    <View style={styles.row} testID={testID}>
      <ScreenTitleGlyph icon={icon} />
      <Text accessibilityRole="header" numberOfLines={2} style={[styles.title, textStyle]}>{title}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { alignItems: 'center', flexDirection: 'row', flexShrink: 1, gap: spacing.sm, minWidth: 0 },
  icon: { flexShrink: 0 },
  title: { color: colors.textPrimary, flexShrink: 1, fontSize: 17, fontWeight: '700' },
});
