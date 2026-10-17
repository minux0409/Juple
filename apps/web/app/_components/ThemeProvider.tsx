'use client';

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { parseThemePreference, resolveTheme, THEME_COLOR, THEME_STORAGE_KEY, type ResolvedTheme, type ThemePreference } from '../../lib/theme';

interface ThemeState {
  readonly preference: ThemePreference;
  readonly resolved: ResolvedTheme;
  readonly setPreference: (next: ThemePreference) => void;
}

const ThemeContext = createContext<ThemeState | null>(null);

function readStoredPreference(): ThemePreference {
  try {
    return parseThemePreference(window.localStorage.getItem(THEME_STORAGE_KEY));
  } catch {
    return 'system';
  }
}

/** Writes the resolved theme where the CSS (and the browser chrome) read it - the same three things the inline bootstrap script sets. */
export function applyTheme(resolved: ResolvedTheme): void {
  const root = document.documentElement;
  root.setAttribute('data-theme', resolved);
  root.style.colorScheme = resolved;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', THEME_COLOR[resolved]);
}

/**
 * The one place that knows the appearance: the saved choice (this browser), the system's own scheme (followed live while the choice is
 * 시스템 설정 사용, ignored for an explicit Light / Dark) and the resolved theme on <html>. Sign-out and account changes never touch it.
 */
export function ThemeProvider({ children }: { readonly children: ReactNode }) {
  // Seeded from the browser at once (the provider draws nothing of its own, so there is no server/client markup to disagree): the first
  // effect then applies exactly what the bootstrap script already put on <html> - no flash back to Light.
  const [preference, setPreferenceState] = useState<ThemePreference>(() => (typeof window === 'undefined' ? 'system' : readStoredPreference()));
  const [systemDark, setSystemDark] = useState(() => typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches);

  useEffect(() => {
    const query = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = (event: MediaQueryListEvent) => setSystemDark(event.matches);
    query.addEventListener('change', onChange);
    // Another tab changed the choice.
    const onStorage = (event: StorageEvent) => {
      if (event.key === THEME_STORAGE_KEY) {
        setPreferenceState(readStoredPreference());
      }
    };
    window.addEventListener('storage', onStorage);
    return () => {
      query.removeEventListener('change', onChange);
      window.removeEventListener('storage', onStorage);
    };
  }, []);

  const resolved = resolveTheme(preference, systemDark);
  useEffect(() => {
    applyTheme(resolved);
  }, [resolved]);

  const value = useMemo<ThemeState>(
    () => ({
      preference,
      resolved,
      setPreference: next => {
        setPreferenceState(next);
        try {
          window.localStorage.setItem(THEME_STORAGE_KEY, next);
        } catch {
          // Storage unavailable: kept for this page only.
        }
      },
    }),
    [preference, resolved],
  );
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeState {
  const value = useContext(ThemeContext);
  if (!value) {
    throw new Error('useTheme must be used inside the ThemeProvider.');
  }
  return value;
}
