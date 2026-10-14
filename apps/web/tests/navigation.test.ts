import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { getAppDictionary } from '../lib/appDictionary.ts';
import { APP_LANGUAGES } from '../lib/appI18n.ts';
import { MOBILE_STRING_KEYS } from '../lib/appI18nMobileKeys.ts';
import { activeMainNav, MAIN_NAV_ITEMS } from '../lib/appNavigation.ts';

const page = (path: string) => readFileSync(new URL(`../app/(app)/${path}`, import.meta.url), 'utf8');

describe('main navigation: Home / Archive / Collections / Friends / 삭제 이력 / My Page', () => {
  it('six destinations, in order, on their existing routes with the mobile icons', () => {
    assert.deepEqual(
      MAIN_NAV_ITEMS.map(item => [item.href, item.labelKey, item.icon]),
      [
        ['/', 'navHome', 'Home'],
        ['/archive', 'navArchive', 'Archive'],
        ['/collections', 'navCollections', 'Folder'],
        ['/me/friends', 'friendsTitle', 'People'],
        ['/me/trash', 'trashTitle', 'Trash'],
        ['/me', 'settingsSectionTitle', 'Settings'],
      ],
    );
    for (const route of ['me/friends/page.tsx', 'me/trash/page.tsx']) {
      assert.ok(existsSync(new URL(`../app/(app)/${route}`, import.meta.url)), route);
    }
  });

  it('exactly one destination is active; 친구 and 삭제 이력 never also light up 내 페이지', () => {
    const cases: [string, string | null][] = [
      ['/', '/'],
      ['/archive', '/archive'],
      ['/collections', '/collections'],
      ['/collections/12/items/34', '/collections'],
      ['/me/friends', '/me/friends'],
      ['/me/friends/', '/me/friends'],
      ['/me/trash', '/me/trash'],
      ['/me', '/me'],
      ['/me/settings', '/me'],
      ['/me/language', '/me'],
      ['/me/account/delete', '/me'],
      ['/items/34', null],
      ['/meet', null],
    ];
    for (const [path, expected] of cases) {
      assert.equal(activeMainNav(path), expected, path);
    }
  });

  it('the shell draws the list from MAIN_NAV_ITEMS (one list for the side bar and the narrow top bar), and has no footer', () => {
    const shell = page('AppShell.tsx');
    assert.match(shell, /MAIN_NAV_ITEMS\.map/);
    assert.match(shell, /activeMainNav\(pathname\)/);
    assert.doesNotMatch(shell, /styles\.account|accountLabel|signOut/);
    const css = page('app.module.css');
    assert.doesNotMatch(css, /^\.account \{/m, 'the footer style is gone');
    // Below 860px the side bar is a top bar whose destinations scroll sideways - all six, Friends and 삭제 이력 included.
    assert.match(css, /@media \(max-width: 860px\) \{[\s\S]*?\.nav \{\s*order: 3;\s*flex: 1 0 100%;\s*flex-direction: row;\s*overflow-x: auto;/);
  });

  it('the labels are the mobile strings in every language', () => {
    assert.equal(MOBILE_STRING_KEYS.friendsTitle, 'friends.title');
    assert.equal(MOBILE_STRING_KEYS.trashTitle, 'settings.trash');
    for (const language of APP_LANGUAGES) {
      const dictionary = getAppDictionary(language);
      for (const item of MAIN_NAV_ITEMS) {
        assert.ok(dictionary[item.labelKey]?.trim(), `${language} ${item.labelKey}`);
      }
    }
  });
});

describe('내 페이지: nested settings - app side bar | inner settings list | content pane', () => {
  const view = page('me/ProfileEditView.tsx');
  const sections = page('me/MyPageSections.tsx');
  const frame = page('me/layout.tsx');

  it('the frame lists only real settings, in order, and wraps 내 페이지 and the pages it opens - never 친구 / 삭제 이력', () => {
    const nav = readFileSync(new URL('../lib/settingsNav.ts', import.meta.url), 'utf8');
    const order = ["'/me'", "'/me/language'", "'/me/collection-lock'", "'/me/subscription'", "'/me/account'", "'/me/account/delete'"].map(href => nav.indexOf(`href: ${href}`));
    assert.ok(order.every((at, i) => at > 0 && (i === 0 || at > order[i - 1])), 'profile, language, lock, subscription, account, delete');
    assert.doesNotMatch(nav, /\/me\/friends|\/me\/trash/);
    assert.match(frame, /activeSettingsItem\(pathname\)/);
    assert.match(frame, /if \(!active\) \{\s*return <>\{children\}<\/>;/);
    assert.match(frame, /aria-current=\{item\.key === active\.key \? 'page' : undefined\}/);
    assert.match(frame, /<Link\b/, 'real routes: back / forward / reload / links keep working');
  });

  it('the active item follows the address; the danger item is last and apart; the friends and trash addresses have no frame', async () => {
    const nav = await import('../lib/settingsNav.ts');
    assert.equal(nav.activeSettingsItem('/me')?.key, 'profile');
    assert.equal(nav.activeSettingsItem('/me/profile')?.key, 'profile', 'the old address still belongs to the same item');
    assert.equal(nav.activeSettingsItem('/me/account')?.key, 'account');
    assert.equal(nav.activeSettingsItem('/me/account/delete')?.key, 'deleteAccount');
    assert.equal(nav.activeSettingsItem('/me/account/')?.key, 'account');
    assert.equal(nav.isSettingsShellPath('/me/friends'), false);
    assert.equal(nav.isSettingsShellPath('/me/trash'), false);
    assert.equal(nav.SETTINGS_NAV_ITEMS.at(-1)?.danger, true);
    assert.equal(nav.SETTINGS_NAV_ITEMS.filter(item => item.danger).length, 1);
  });

  it('/me opens straight on 프로필 편집: the form, no summary card, no 프로필 편집 button, no middle screen; the old address redirects', () => {
    assert.match(page('me/page.tsx'), /<ProfileEditView \/>/);
    assert.match(view, /<SettingsPage title=\{dictionary\.profileEdit\}>/);
    assert.match(view, /PROFILE_PATH\}\/display-name/);
    assert.doesNotMatch(view, /profileCard|href="\/me\/profile"|dictionary\.logout|signOut/);
    assert.ok(!existsSync(new URL('../app/(app)/me/MyPageView.tsx', import.meta.url)), 'the summary view is gone');
    assert.match(page('me/profile/page.tsx'), /redirect\('\/me'\);/);
    assert.doesNotMatch(page('me/profile/page.tsx'), /'use client'/, 'a server redirect');
    const nav = readFileSync(new URL('../lib/settingsNav.ts', import.meta.url), 'utf8');
    assert.match(nav, /\{ key: 'profile', href: '\/me', paths: \['\/me', '\/me\/profile'\], group: 0 \}/);
  });

  it('saving stays on /me (no navigation), the form shows the saved value; cancel restores the saved name', () => {
    assert.doesNotMatch(view, /useRouter|router\.(push|back|replace)/);
    // the nickname, then (when one was picked) the photo; both feed the shared profile at once, then "saved" shows
    assert.match(view, /updateProfile\(updated\);\s*setNickname\(updated\.displayName \?\? ''\);/);
    assert.match(view, /setPickedPhoto\(null\);\s*\} catch[\s\S]*?setSaved\(true\);/);
    assert.match(view, /onClick=\{\(\) => \{\s*setNickname\(profile\.displayName \?\? ''\);\s*setPickedPhoto\(null\);/);
    assert.match(view, /disabled=\{busy \|\| \(!nicknameChanged && !pickedPhoto\)\}/);
  });

  it('로그아웃 is the settings rail\'s bottom action block: [로그아웃] divider [계정 삭제], asking first; nowhere else', () => {
    const footer = frame.slice(frame.indexOf('styles.settingsRailFooter'));
    const at = ['dictionary.logout', 'styles.settingsRailDivider', "item => item.danger"].map(token => footer.indexOf(token));
    assert.ok(at.every((position, index) => position > 0 && (index === 0 || position > at[index - 1])), 'logout, divider, delete');
    assert.match(frame, /<ConfirmDialog[\s\S]*signOut\(\);/);
    assert.equal(frame.match(/dictionary\.logout/g)?.length, 2, "the button and the dialog's confirm");
    assert.match(frame, /SETTINGS_NAV_ITEMS\.filter\(item => !item\.danger\)/, 'the menu above does not repeat 계정 삭제');
    for (const file of ['me/MyPageSections.tsx', 'AppShell.tsx', 'me/ProfileEditView.tsx']) {
      assert.doesNotMatch(page(file), /dictionary\.logout|signOut/, file);
    }
    const css = page('app.module.css');
    assert.match(css, /\.settingsRailFooter \{[^}]*margin-top: auto;[^}]*border-top: 1px solid var\(--app-divider\);/);
    assert.doesNotMatch(css.slice(css.indexOf('.settingsNavAction {'), css.indexOf('.settingsNavAction:hover')), /danger|color: var\(--danger\)/, 'logout is the normal text colour');
  });

  it('no user-visible 내 페이지: the side bar, every page title and the rail say 설정 / their own name; the main side bar keeps its six items', async () => {
    const appNav = await import('../lib/appNavigation.ts');
    assert.deepEqual(appNav.MAIN_NAV_ITEMS.map(item => item.labelKey), ['navHome', 'navArchive', 'navCollections', 'friendsTitle', 'trashTitle', 'settingsSectionTitle']);
    const shown = (await import('node:fs')).readdirSync(new URL('../app/(app)/', import.meta.url), { recursive: true }) as string[];
    for (const file of shown.filter(name => /\.(tsx|ts)$/.test(name))) {
      assert.doesNotMatch(page(file.split('\\').join('/')), /dictionary\.navMyPage|>\s*내 페이지\s*</, file);
    }
    const dictionaryFile = readFileSync(new URL('../lib/appDictionary.ts', import.meta.url), 'utf8');
    assert.doesNotMatch(dictionaryFile, /내 페이지|My Page/);
    const titles: ReadonlyArray<readonly [string, string]> = [
      ['me/ProfileEditView.tsx', 'dictionary.profileEdit'],
      ['me/language/page.tsx', 'dictionary.languageTitle'],
      ['me/collection-lock/page.tsx', 'dictionary.collectionLock'],
      ['me/subscription/page.tsx', 'dictionary.subscriptionTitle'],
      ['me/account/page.tsx', 'dictionary.accountSectionTitle'],
    ];
    for (const [file, title] of titles) {
      assert.match(page(file), new RegExp(`<SettingsPage[^>]*title=\{${title.replace('.', '\.')}\}`), file);
    }
  });

  it('구독 shows only the server-reported state with the Play manage link; no purchase on the Web', () => {
    const subscription = sections.slice(sections.indexOf('export function SubscriptionSection'), sections.indexOf('function emailOf'));
    assert.match(subscription, /describeSubscription\(storeSubscription, entitlement\)/);
    assert.match(subscription, /href=\{PLAY_SUBSCRIPTIONS_URL\}/);
    assert.doesNotMatch(subscription, /requestPurchase|requestSubscription|billing\/google|method: 'POST'/);
    assert.match(page('me/subscription/page.tsx'), /<SubscriptionSection showTitle=\{false\} \/>/);
  });

  it('계정: 로그인 방식, the e-mail, 비밀번호 재설정 (fresh sign-in); the deletion flow is its own deliberate page', () => {
    const account = sections.slice(sections.indexOf('export function AccountSection'));
    assert.ok(account.indexOf('dictionary.signInMethodLabel') < account.indexOf('{email}'));
    assert.match(account, /reauthenticate\('passwordReset'\)/);
    assert.doesNotMatch(account, /\/me\/account\/delete/);
    assert.match(page('me/account/page.tsx'), /<AccountSection showTitle=\{false\} \/>/);
    assert.ok(existsSync(new URL('../app/(app)/me/account/delete/page.tsx', import.meta.url)));
  });

  it("section titles: 구독 is the mobile string; 계정 is the Web's own (never a support-inquiry string); every language has the labels", () => {
    assert.ok(!('accountSectionTitle' in MOBILE_STRING_KEYS));
    // Only 고객센터's own strings (the inquiry feature) are 문의 strings; no 내 페이지 section label borrows one.
    const inquiryKeys = Object.entries(MOBILE_STRING_KEYS).filter(([, key]) => key.startsWith('inquiry.')).map(([web]) => web);
    assert.ok(inquiryKeys.includes('customerCenterInquiry'));
    assert.ok(inquiryKeys.every(web => web === 'customerCenterInquiry' || web.startsWith('inquiry')), inquiryKeys.join(','));
    assert.equal(getAppDictionary('ko').accountSectionTitle, '계정');
    assert.equal(getAppDictionary('en').accountSectionTitle, 'Account');
    assert.equal(getAppDictionary('ja').accountSectionTitle, 'Account', 'other languages: the English Web-only fallback');
    for (const language of APP_LANGUAGES) {
      const dictionary = getAppDictionary(language);
      for (const key of ['subscriptionTitle', 'accountSectionTitle', 'signInMethodLabel', 'profileEdit', 'languageTitle', 'collectionLock', 'accountDeleteTitle'] as const) {
        assert.ok(dictionary[key]?.trim(), `${language} ${key}`);
      }
    }
  });

  it('the old addresses still work: /me/settings lands on 언어; /me/subscription and /me/account are real pages of the frame', () => {
    assert.match(page('me/settings/page.tsx'), /redirect\('\/me\/language'\);/);
    for (const route of ['me/subscription/page.tsx', 'me/account/page.tsx', 'me/language/page.tsx', 'me/collection-lock/page.tsx', 'me/profile/page.tsx']) {
      assert.ok(existsSync(new URL(`../app/(app)/${route}`, import.meta.url)), route);
    }
  });

  it('inside the frame there is no 뒤로 (the inner list is the way); 친구 and 삭제 이력 have no 뒤로 and 삭제 이력 explains its limit under the title', () => {
    assert.match(page('me/SettingsPage.tsx'), /backHref && !framed \? <BackButton/);
    assert.match(page('me/friends/page.tsx'), /<SettingsPage backHref=\{null\} icon="People" title=\{dictionary\.friendsTitle\}/);
    assert.match(page('me/trash/page.tsx'), /backHref=\{null\}\s*subtitle=\{formatMessage\(dictionary\.trashLimitNotice/);
  });

  it('layout: [app side bar][settings rail 280-320px][wide pane]; the rail is a full-height column, not a floating card; below 860px it is a row of tabs', () => {
    const css = page('app.module.css');
    assert.match(css, /\.mySettings \{[^}]*grid-template-columns: clamp\(280px, 20vw, 320px\) minmax\(0, 1fr\);[^}]*min-height: 100vh;/);
    assert.match(css, /\.contentInner:has\(> \.mySettings\) \{\s*max-width: none;/);
    assert.match(css, /\.settingsRail \{[^}]*position: sticky;[^}]*height: 100vh;[^}]*border-inline-end: 1px solid var\(--app-divider\);/);
    assert.doesNotMatch(css.slice(css.indexOf('.settingsRail {'), css.indexOf('.settingsRailTitle')), /border-radius|box-shadow/);
    assert.match(css, /@media \(max-width: 1099px\) \{\s*\.mySettings \{\s*grid-template-columns: 240px minmax\(0, 1fr\);/);
    assert.match(css, /@media \(max-width: 859px\) \{\s*\.mySettings \{\s*grid-template-columns: minmax\(0, 1fr\);[\s\S]*?\.settingsRailList \{\s*flex-direction: row;\s*overflow-x: auto;/);
    assert.match(css, /\.settingsPane > \* \{\s*max-width: 880px;\s*margin-inline: auto;/);
    assert.match(css, /\.settingsNavDanger \{\s*color: var\(--danger\);/);
    assert.match(css, /@media \(max-width: 860px\) \{\s*\.profileActions \{\s*flex-basis: 100%;/);
  });

});

describe('내 페이지: reaching a page', () => {
  it('비밀번호 재설정 comes back to 계정 (a page of the frame)', () => {
    const sections = page('me/MyPageSections.tsx');
    assert.match(sections, /clearReauthentication\(\);\s*document\.getElementById\(MY_PAGE_SECTION_IDS\.account\)\?\.scrollIntoView/);
  });
});
