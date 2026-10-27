import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { RTL_LANGUAGES } from './index';
import { useTheme } from '../theme/ThemeContext';
import { colors, themedStyles } from '../theme/tokens';

export type LayoutDirection = 'ltr' | 'rtl';

/** The selected app language decides the direction - never the (sticky) native I18nManager flag. */
export function layoutDirectionFor(language: string | undefined): LayoutDirection {
  return language !== undefined && (RTL_LANGUAGES as readonly string[]).includes(language) ? 'rtl' : 'ltr';
}

/** Re-renders on every language change, so the whole app follows it within the same session. */
export function useLayoutDirection(): LayoutDirection {
  const { i18n } = useTranslation();
  return layoutDirectionFor(i18n.language);
}

/**
 * Lays the whole app out in the current language's direction. I18nManager.forceRTL only affects the
 * next cold launch - and once a session started in RTL, its native root stays RTL - so switching
 * Arabic → Korean used to leave everything mirrored until a restart. An explicit Yoga `direction`
 * on this root overrides whatever the native root inherited, for every view below it (modals
 * included, which Fabric lays out inside the same tree), and changes the moment the language does.
 *
 * Its background is the app's own background, and it must follow a theme change made while the app runs (a Light/Dark choice in
 * 화면 모드, or the OS switching on 시스템 설정 사용): this view is what shows behind the native stack, so iOS push / pop transitions
 * reveal it at the moving screen's rounded corners and edge. Without the subscription it kept the previous theme's colour (React
 * skips it - its props never change), which flashed a white line at the left edge on push and the right edge on back in Dark mode.
 */
export function LayoutDirectionRoot({ children }: { readonly children: ReactNode }) {
  useTheme();
  const direction = useLayoutDirection();
  return (
    <View style={[styles.root, { direction }]} testID="layout-direction-root">
      {children}
    </View>
  );
}

const styles = themedStyles(() => ({
  root: { backgroundColor: colors.background, flex: 1 },
}));
