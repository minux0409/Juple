import AsyncStorage from '@react-native-async-storage/async-storage';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ComponentType, type ReactNode } from 'react';
import { Appearance, NativeModules, Platform, useColorScheme } from 'react-native';
import { colors, setActiveColorScheme, type ColorScheme } from './tokens';

/**
 * Appearance (화면 모드): the device's own choice - 시스템 설정 사용 / 라이트 / 다크 - kept on THIS device only (AsyncStorage, like the
 * language and view-mode preferences; never sent to the account, never cleared by signing out or switching accounts) and resolved
 * to the theme actually shown. ONE place decides it: screens read colours from `colors` / themedStyles and call useTheme() only
 * when they need the scheme itself - none of them calls useColorScheme().
 */
export const THEME_PREFERENCES = ['system', 'light', 'dark'] as const;
export type ThemePreference = (typeof THEME_PREFERENCES)[number];

export const THEME_STORAGE_KEY = 'juple.themePreference';
export const DEFAULT_THEME_PREFERENCE: ThemePreference = 'system';

export function parseThemePreference(stored: string | null | undefined): ThemePreference {
  return (THEME_PREFERENCES as readonly string[]).includes(stored ?? '') ? (stored as ThemePreference) : DEFAULT_THEME_PREFERENCE;
}

/** An explicit Light / Dark ignores the system; 시스템 설정 사용 follows it (an unknown system scheme is Light). */
export function resolveScheme(preference: ThemePreference, system: ColorScheme | null | undefined): ColorScheme {
  return preference === 'system' ? (system === 'dark' ? 'dark' : 'light') : preference;
}

export async function loadThemePreference(): Promise<ThemePreference> {
  try {
    return parseThemePreference(await AsyncStorage.getItem(THEME_STORAGE_KEY));
  } catch {
    return DEFAULT_THEME_PREFERENCE;
  }
}

async function saveThemePreference(preference: ThemePreference): Promise<void> {
  try {
    await AsyncStorage.setItem(THEME_STORAGE_KEY, preference);
  } catch {
    // Storage unavailable: the choice lasts for this session.
  }
}

/**
 * Tells the OS which appearance the app itself wants (Android: AppCompat night mode; iOS: the window's userInterfaceStyle), so native
 * chrome - status/navigation bar icons, the keyboard, alerts, pickers, text-input selection handles - follows the app's choice
 * instead of the system's. 'auto' = back to following the system.
 */
export function applyNativeAppearance(preference: ThemePreference): void {
  try {
    Appearance.setColorScheme(preference === 'system' ? 'auto' : preference);
  } catch {
    // An old/unsupported native module: the app's own colours still follow the choice.
  }
}

/**
 * Android only: the system navigation bar (home / back / recents area) follows the resolved theme, live - icon appearance and the
 * colour behind the bar (the same surface as the bottom tab bar), so no white strip is left under a dark app. iOS has no such bar.
 */
export function applyNavigationBarTheme(scheme: ColorScheme, color: string): void {
  if (Platform.OS !== 'android') {
    return;
  }
  try {
    NativeModules.JupleSystemBars?.setNavigationBarTheme(scheme === 'dark', color);
  } catch {
    // Module missing (an older native build): the bar keeps the system's own look.
  }
}

interface ThemeState {
  readonly preference: ThemePreference;
  readonly scheme: ColorScheme;
  readonly isDark: boolean;
  readonly setPreference: (next: ThemePreference) => void;
}

const ThemeContext = createContext<ThemeState | null>(null);

/**
 * `initialPreference` is read from storage BEFORE the first frame (App waits for it, like the language), so the first render is already
 * in the right theme. The system scheme is followed live (useColorScheme re-renders on an OS change, also after returning from the
 * background) but only matters while the choice is 시스템 설정 사용.
 */
export function ThemeProvider({ initialPreference = DEFAULT_THEME_PREFERENCE, children }: { readonly initialPreference?: ThemePreference; readonly children: ReactNode }) {
  const [preference, setPreferenceState] = useState<ThemePreference>(initialPreference);
  // With setColorScheme(null) this is the system's; with an explicit override it echoes the override - so for 'system' it is exactly the OS.
  const reported = useColorScheme();
  const scheme = resolveScheme(preference, reported);
  // Before children render: every style read in this render pass is built for the theme in force.
  setActiveColorScheme(scheme);

  useEffect(() => {
    applyNativeAppearance(preference);
  }, [preference]);

  // The resolved scheme (also when the OS flips while on 시스템 설정 사용) - the bar colour is the tab bar's surface.
  const navigationBarColor = colors.surface;
  useEffect(() => {
    applyNavigationBarTheme(scheme, navigationBarColor);
  }, [scheme, navigationBarColor]);

  const setPreference = useCallback((next: ThemePreference) => {
    setPreferenceState(next);
    saveThemePreference(next).catch(() => undefined);
  }, []);

  const value = useMemo<ThemeState>(() => ({ preference, scheme, isDark: scheme === 'dark', setPreference }), [preference, scheme, setPreference]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

/**
 * How a theme change reaches what is already on screen, without remounting anything (so every screen keeps its local state, typed text
 * and scroll position): a component that READS the theme - useTheme() - re-renders when it changes, and its non-memoized children
 * re-render with it. Styles are built lazily per theme (themedStyles), so a re-render is all they need.
 *
 * React Navigation does not re-render a screen from its parent (it holds the screen's element static), so each screen component is
 * registered through `themedScreen(Screen)`: a thin, cached wrapper that reads the theme and renders the screen. One call per
 * registration in the navigators - not a hook in every screen. The few components that live outside a navigator (toast, banner host,
 * update gate) and the memoized ones call useTheme() themselves.
 */
const themedScreens = new WeakMap<ComponentType<never>, ComponentType<never>>();

export function themedScreen<P extends object>(Screen: ComponentType<P>): ComponentType<P> {
  let wrapper = themedScreens.get(Screen as ComponentType<never>) as ComponentType<P> | undefined;
  if (!wrapper) {
    const Themed = (props: P) => {
      useTheme();
      return <Screen {...props} />;
    };
    Themed.displayName = `Themed(${Screen.displayName ?? Screen.name ?? 'Screen'})`;
    themedScreens.set(Screen as ComponentType<never>, Themed as ComponentType<never>);
    wrapper = Themed;
  }
  return wrapper;
}

export function useTheme(): ThemeState {
  const value = useContext(ThemeContext);
  if (!value) {
    // Outside a provider (a test rendering one component): the Light default, no crash.
    return { preference: DEFAULT_THEME_PREFERENCE, scheme: 'light', isDark: false, setPreference: () => undefined };
  }
  return value;
}
