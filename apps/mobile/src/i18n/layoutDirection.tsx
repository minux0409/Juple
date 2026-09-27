import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { RTL_LANGUAGES } from './index';

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
 */
export function LayoutDirectionRoot({ children }: { readonly children: ReactNode }) {
  const direction = useLayoutDirection();
  return (
    <View style={[styles.root, { direction }]} testID="layout-direction-root">
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
});
