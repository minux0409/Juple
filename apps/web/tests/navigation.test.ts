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
        ['/me', 'navMyPage', 'User'],
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

describe('내 페이지: one page - profile header, 설정, 구독, 계정, 위험 구역', () => {
  const view = page('me/MyPageView.tsx');
  const sections = page('me/MyPageSections.tsx');

  it('no tab bar: the sections follow the profile header in order on /me', () => {
    assert.doesNotMatch(view + sections, /tabBar|MY_PAGE_TABS|activeMyPageTab|MyPageFrame/);
    assert.doesNotMatch(page('app.module.css'), /\.tabBar|\.tabActive|\.tabPanel/);
    const header = view.indexOf('className={styles.profileCard}');
    const order = ['<SettingsSection />', '<SubscriptionSection />', '<AccountSection />', '<DangerZoneSection />'].map(tag => view.indexOf(tag));
    assert.ok(header > 0 && order.every((at, i) => at > header && (i === 0 || at > order[i - 1])), 'header, 설정, 구독, 계정, 위험 구역');
    assert.match(page('me/page.tsx'), /<MyPageView \/>/);
  });

  it('the header has 프로필 편집 and 로그아웃 (asked first); 로그아웃 is nowhere else', () => {
    const header = view.indexOf('className={styles.profileCard}');
    const firstSection = view.indexOf('<SettingsSection />');
    const edit = view.indexOf('href="/me/profile"');
    const logout = view.indexOf('setConfirmSignOut(true)');
    assert.ok(edit > header && edit < firstSection && logout > header && logout < firstSection);
    assert.match(view, /<ConfirmDialog[\s\S]*signOut\(\);/);
    assert.equal(view.match(/dictionary\.logout/g)?.length, 2, 'the button and the dialog\'s confirm');
    for (const file of ['me/MyPageSections.tsx', 'AppShell.tsx']) {
      assert.doesNotMatch(page(file), /dictionary\.logout|signOut/, file);
    }
  });

  it('설정: 언어 and 컬렉션 잠금 rows with their current value, opening the existing screens', () => {
    assert.ok(sections.indexOf('href="/me/language"') < sections.indexOf('href="/me/collection-lock"'));
    assert.match(sections, /value=\{dictionary\[LANGUAGE_LABEL_KEYS\[languagePreference\]\]\}/);
  });

  it('구독 shows only the server-reported state with the Play manage link; no purchase on the Web', () => {
    const subscription = sections.slice(sections.indexOf('export function SubscriptionSection'), sections.indexOf('function emailOf'));
    assert.match(subscription, /describeSubscription\(storeSubscription, entitlement\)/);
    assert.match(subscription, /href=\{PLAY_SUBSCRIPTIONS_URL\}/);
    assert.doesNotMatch(subscription, /requestPurchase|requestSubscription|billing\/google|method: 'POST'/);
  });

  it('계정: 로그인 방식, the e-mail, 비밀번호 재설정 (fresh sign-in); 위험 구역 apart with the existing delete flow', () => {
    const account = sections.slice(sections.indexOf('export function AccountSection'), sections.indexOf('export function DangerZoneSection'));
    assert.ok(account.indexOf('dictionary.signInMethodLabel') < account.indexOf('{email}'));
    assert.match(account, /reauthenticate\('passwordReset'\)/);
    assert.doesNotMatch(account, /\/me\/account\/delete/);
    const danger = sections.slice(sections.indexOf('export function DangerZoneSection'));
    assert.match(danger, /className=\{styles\.dangerZone\}[\s\S]*href="\/me\/account\/delete"/);
    assert.ok(existsSync(new URL('../app/(app)/me/account/delete/page.tsx', import.meta.url)));
  });

  it('section titles: 구독 is the mobile string; 설정 / 계정 are the Web\'s own (never a support-inquiry string); every language has one', () => {
    assert.ok(!('accountSectionTitle' in MOBILE_STRING_KEYS));
    assert.ok(!Object.values(MOBILE_STRING_KEYS).some(key => key.startsWith('inquiry.')), 'no 내 페이지 label borrows the 문의 strings');
    assert.equal(getAppDictionary('ko').accountSectionTitle, '계정');
    assert.equal(getAppDictionary('en').accountSectionTitle, 'Account');
    assert.equal(getAppDictionary('ja').accountSectionTitle, 'Account', 'other languages: the English Web-only fallback');
    assert.equal(getAppDictionary('ko').settingsSectionTitle, '설정');
    for (const language of APP_LANGUAGES) {
      const dictionary = getAppDictionary(language);
      for (const key of ['settingsSectionTitle', 'subscriptionTitle', 'accountSectionTitle', 'signInMethodLabel', 'dangerZone'] as const) {
        assert.ok(dictionary[key]?.trim(), `${language} ${key}`);
      }
    }
  });

  it('no 친구 / 삭제 이력 in 내 페이지 (they are main destinations)', () => {
    assert.doesNotMatch(view + sections, /\/me\/friends|\/me\/trash|settingsTile/);
  });

  it('the old tab addresses still work: /me/settings, /me/subscription, /me/account redirect to their section of /me', () => {
    for (const id of ['settings', 'subscription', 'account']) {
      const route = page(`me/${id}/page.tsx`);
      assert.match(route, new RegExp(`redirect\\('/me#${id}'\\);`), id);
      assert.match(sections, new RegExp(`${id}: '${id}'`), `section id ${id}`);
    }
    assert.match(sections, /id=\{MY_PAGE_SECTION_IDS\.settings\}[\s\S]*id=\{MY_PAGE_SECTION_IDS\.subscription\}[\s\S]*id=\{MY_PAGE_SECTION_IDS\.account\}/);
    assert.match(view, /document\.getElementById\(id\)\?\.scrollIntoView/);
  });

  it('pages opened from 내 페이지 go back to /me; 친구 and 삭제 이력 have no 뒤로 and 삭제 이력 explains its limit under the title', () => {
    assert.match(page('me/SettingsPage.tsx'), /backHref = '\/me'/);
    for (const file of ['me/language/page.tsx', 'me/collection-lock/page.tsx', 'me/account/delete/page.tsx', 'me/profile/page.tsx']) {
      assert.doesNotMatch(page(file), /backHref=/, file);
    }
    assert.match(page('me/friends/page.tsx'), /<SettingsPage backHref=\{null\} title=\{dictionary\.friendsTitle\}/);
    assert.match(page('me/trash/page.tsx'), /backHref=\{null\}\s*subtitle=\{formatMessage\(dictionary\.trashLimitNotice/);
  });

  it('layout: one column at the medium width with ~32px between sections; the header buttons move under on a narrow window', () => {
    const css = page('app.module.css');
    assert.match(css, /\.myPage \{[^}]*gap: 32px;[^}]*max-width: var\(--content-medium\);/);
    assert.match(css, /@media \(max-width: 860px\) \{\s*\.profileActions \{\s*flex-basis: 100%;/);
  });
});

describe('내 페이지: reaching a section', () => {
  it('a section reached by its address stays clear of the sticky narrow top bar; 비밀번호 재설정 comes back to 계정', () => {
    const css = page('app.module.css');
    assert.match(css, /\.myPage > section \{[^}]*scroll-margin-top: 24px;/);
    assert.match(css, /@media \(max-width: 860px\) \{[\s\S]*?\.myPage > section \{[^}]*scroll-margin-top: 128px;/);
    const sections = page('me/MyPageSections.tsx');
    assert.match(sections, /clearReauthentication\(\);\s*document\.getElementById\(MY_PAGE_SECTION_IDS\.account\)\?\.scrollIntoView/);
  });
});
