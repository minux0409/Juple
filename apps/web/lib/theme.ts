/**
 * Appearance (화면 모드) of the Web app: the person's choice - 시스템 설정 사용 / 라이트 / 다크 - kept in THIS browser only (localStorage, like
 * the mobile device preference; never account data, never sent anywhere, and kept across sign-out and account changes) and resolved
 * to the theme actually shown. The resolved theme is written to <html data-theme> BEFORE first paint by THEME_BOOTSTRAP_SCRIPT, so
 * a saved Dark never flashes white; the CSS re-points one set of semantic variables under html[data-theme='dark'].
 */
export const THEME_PREFERENCES = ['system', 'light', 'dark'] as const;
export type ThemePreference = (typeof THEME_PREFERENCES)[number];
export type ResolvedTheme = 'light' | 'dark';

export const THEME_STORAGE_KEY = 'juple.themePreference';
export const DEFAULT_THEME_PREFERENCE: ThemePreference = 'system';

/** Anything unknown or missing is the default (시스템 설정 사용). */
export function parseThemePreference(stored: string | null | undefined): ThemePreference {
  return (THEME_PREFERENCES as readonly string[]).includes(stored ?? '') ? (stored as ThemePreference) : DEFAULT_THEME_PREFERENCE;
}

/** An explicit Light / Dark ignores the system; 시스템 설정 사용 follows it. */
export function resolveTheme(preference: ThemePreference, systemPrefersDark: boolean): ResolvedTheme {
  return preference === 'system' ? (systemPrefersDark ? 'dark' : 'light') : preference;
}

/** The browser chrome colour (mobile address bar) per resolved theme - the page background of each. */
export const THEME_COLOR: Readonly<Record<ResolvedTheme, string>> = { light: '#f7f9fc', dark: '#101318' };

/**
 * Runs inline in <head>, before the body paints (no framework code, no network, no eval - it needs no CSP allowance beyond what the
 * site already has). Same rules as resolveTheme; storage may be blocked, then it is 시스템 설정 사용. Also sets color-scheme-aware
 * theme-color. Kept in step with this file by tests.
 */
export const THEME_BOOTSTRAP_SCRIPT = `(function(){try{var p=null;try{p=localStorage.getItem('${THEME_STORAGE_KEY}')}catch(e){}if(p!=='light'&&p!=='dark')p='system';var d=p==='dark'||(p==='system'&&window.matchMedia&&window.matchMedia('(prefers-color-scheme: dark)').matches);var t=d?'dark':'light';var r=document.documentElement;r.setAttribute('data-theme',t);r.style.colorScheme=t;var m=document.querySelector('meta[name="theme-color"]');if(m)m.setAttribute('content',d?'${THEME_COLOR.dark}':'${THEME_COLOR.light}')}catch(e){}})();`;
