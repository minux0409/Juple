import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import vm from 'node:vm';
import { APP_LANGUAGES } from '../lib/appI18n.ts';
import { getAppDictionary } from '../lib/appDictionary.ts';
import { DEFAULT_THEME_PREFERENCE, parseThemePreference, resolveTheme, THEME_BOOTSTRAP_SCRIPT, THEME_COLOR, THEME_PREFERENCES, THEME_STORAGE_KEY } from '../lib/theme.ts';
import { SETTINGS_NAV_ITEMS } from '../lib/settingsNav.ts';

const source = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const css = source('app/(app)/app.module.css');

/** Runs the real inline script in a fake browser and returns what it put on <html>. */
function runBootstrap(stored: string | null, systemDark: boolean, storageThrows = false) {
  const attributes: Record<string, string> = {};
  const meta = { content: '', setAttribute: (name: string, value: string) => void (name === 'content' && (meta.content = value)) };
  const root = { setAttribute: (name: string, value: string) => void (attributes[name] = value), style: { colorScheme: '' } };
  const localStorage = {
    getItem: (key: string) => {
      if (storageThrows) {
        throw new Error('blocked');
      }
      return key === THEME_STORAGE_KEY ? stored : null;
    },
  };
  const window = { matchMedia: (query: string) => ({ matches: query.includes('dark') && systemDark }) };
  vm.runInNewContext(THEME_BOOTSTRAP_SCRIPT, { localStorage, window, document: { documentElement: root, querySelector: () => meta } });
  return { theme: attributes['data-theme'], colorScheme: root.style.colorScheme, themeColor: meta.content };
}

describe('Web appearance: preference and resolution', () => {
  it('defaults to 시스템 설정 사용; unknown stored values are the default', () => {
    assert.equal(DEFAULT_THEME_PREFERENCE, 'system');
    assert.deepEqual([...THEME_PREFERENCES], ['system', 'light', 'dark']);
    assert.equal(parseThemePreference(null), 'system');
    assert.equal(parseThemePreference('purple'), 'system');
    assert.equal(parseThemePreference('dark'), 'dark');
    assert.equal(parseThemePreference('light'), 'light');
  });

  it('system follows the OS (and its runtime change); an explicit Light / Dark ignores it', () => {
    assert.equal(resolveTheme('system', false), 'light');
    assert.equal(resolveTheme('system', true), 'dark');
    assert.equal(resolveTheme('light', true), 'light');
    assert.equal(resolveTheme('dark', false), 'dark');
  });
});

describe('Web appearance: first paint (the inline bootstrap script, run for real)', () => {
  it('the combinations', () => {
    assert.equal(runBootstrap(null, false).theme, 'light');
    assert.equal(runBootstrap(null, true).theme, 'dark');
    assert.equal(runBootstrap('light', true).theme, 'light');
    assert.equal(runBootstrap('dark', false).theme, 'dark');
    assert.equal(runBootstrap('system', true).theme, 'dark');
    assert.equal(runBootstrap('system', false).theme, 'light');
    // blocked storage or garbage: 시스템 설정 사용
    assert.equal(runBootstrap(null, true, true).theme, 'dark');
    assert.equal(runBootstrap('rainbow', false).theme, 'light');
  });

  it('colour-scheme and the browser chrome colour follow the resolved theme', () => {
    assert.deepEqual(runBootstrap('dark', false), { theme: 'dark', colorScheme: 'dark', themeColor: THEME_COLOR.dark });
    assert.deepEqual(runBootstrap('light', true), { theme: 'light', colorScheme: 'light', themeColor: THEME_COLOR.light });
  });

  it('the root layout runs it in head before the body and tolerates the attribute; the key is the provider key', () => {
    const layout = source('app/layout.tsx');
    assert.match(layout, /<html lang="en" suppressHydrationWarning>/);
    assert.ok(layout.indexOf('THEME_BOOTSTRAP_SCRIPT') < layout.indexOf('<body>'));
    assert.match(layout, /<ThemeProvider>\{children\}<\/ThemeProvider>/);
    assert.match(source('app/_components/ThemeProvider.tsx'), /THEME_STORAGE_KEY/);
  });
});

describe('Web appearance: provider and settings', () => {
  const provider = source('app/_components/ThemeProvider.tsx');

  it('follows the OS live, stores locally only, never touches an account or the sign-out path', () => {
    assert.match(provider, /matchMedia\('\(prefers-color-scheme: dark\)'\)/);
    assert.match(provider, /query\.addEventListener\('change'/);
    assert.match(provider, /window\.localStorage\.setItem\(THEME_STORAGE_KEY, next\)/);
    assert.doesNotMatch(provider, /fetch\(|useSignedInApp|signOut|removeItem|clear\(/);
    // seeded from the browser on the first render, so the first effect does not flash back to Light
    assert.match(provider, /typeof window === 'undefined' \? 'system' : readStoredPreference\(\)/);
  });

  it('the Settings rail has 화면 모드 and the page is a radiogroup of the three choices', () => {
    assert.ok(SETTINGS_NAV_ITEMS.some(item => item.key === 'appearance' && item.href === '/me/appearance'));
    const page = source('app/(app)/me/appearance/page.tsx');
    assert.match(page, /role="radiogroup"/);
    assert.match(page, /role="radio"/);
    assert.match(page, /setPreference\(option\)/);
  });

  it('the four labels exist in all 17 languages (translated, not an English fallback)', () => {
    const en = getAppDictionary('en');
    for (const language of APP_LANGUAGES) {
      const words = getAppDictionary(language);
      for (const key of ['appearanceTitle', 'appearanceSystem', 'appearanceLight', 'appearanceDark'] as const) {
        assert.ok(words[key].trim().length > 0, `${language}.${key}`);
        if (language !== 'en') {
          assert.notEqual(words[key], en[key], `${language}.${key}`);
        }
      }
    }
    assert.equal(getAppDictionary('ko').appearanceDark, '다크');
  });
});

describe('Web appearance: the CSS', () => {
  it('dark re-points the same semantic tokens under html[data-theme=dark]; no media-query dark block is left', () => {
    assert.doesNotMatch(css, /prefers-color-scheme/);
    const dark = css.slice(css.indexOf(":global(html[data-theme='dark']) .shell,"));
    for (const token of ['--app-background', '--app-surface', '--app-text', '--app-text-secondary', '--app-border', '--brand', '--on-brand', '--danger', '--on-danger', '--nav-active-bg', '--scrim']) {
      assert.ok(dark.includes(`${token}:`), token);
    }
  });

  it('text on a filled brand / danger surface uses the on-* tokens (white on the light-blue dark brand would fail contrast)', () => {
    const body = (selector: string) => css.slice(css.indexOf(`${selector} {`), css.indexOf('}', css.indexOf(`${selector} {`)));
    for (const selector of ['.primaryAction', '.countPill', '.composerSend', '.openLinkButton']) {
      assert.match(body(selector), /color: var\(--on-brand\)/, selector);
    }
    for (const selector of ['.countBadge', '.attentionBadge', '.toastError']) {
      assert.match(body(selector), /color: var\(--on-danger\)/, selector);
    }
  });

  it('the public pages follow the theme too', () => {
    assert.match(source('app/globals.css'), /:root\[data-theme='dark'\] \{/);
    assert.doesNotMatch(source('app/globals.css'), /prefers-color-scheme/);
  });
});
