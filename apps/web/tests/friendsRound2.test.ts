import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { getAppDictionary } from '../lib/appDictionary.ts';
import { APP_LANGUAGES, formatMessage } from '../lib/appI18n.ts';

const source = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const friends = source('app/(app)/me/friends/page.tsx');

describe('Friends: three tabs - 친구, 받은 요청, 보낸 요청 (no 차단한 사용자)', () => {
  it('has exactly the three tabs; no blocked tab, panel, query or fetch is left in the Friends UI', () => {
    assert.ok(friends.includes("type Tab = 'friends' | 'incoming' | 'outgoing';"));
    for (const key of ['friends', 'incoming', 'outgoing']) {
      assert.ok(friends.includes(`['${key}', dictionary.`), key);
    }
    assert.doesNotMatch(friends, /blocked|Blocked|useSearchParams|BLOCKED_USERS_PATH|safetyBlockedUsers/);
    assert.ok(friends.includes("tab === 'incoming' || tab === 'outgoing'"));
  });

  it('the old /me/blocked-users address lands on the ordinary Friends screen (no tab query), and the panel is gone', () => {
    assert.ok(source('app/(app)/me/blocked-users/page.tsx').includes("redirect('/me/friends')"));
    assert.doesNotMatch(source('app/(app)/me/blocked-users/page.tsx'), /tab=/);
    assert.ok(!existsSync(new URL('../app/(app)/me/blocked-users/BlockedUsers.tsx', import.meta.url)), 'the blocked-users panel is deleted');
    assert.doesNotMatch(source('lib/settingsNav.ts'), /blocked/i);
  });
});

describe('Friends: 함께 공유 중인 컬렉션', () => {
  it('is closed by default and read on demand for ONE friendship - the list cards fetch nothing', () => {
    assert.match(friends, /kind: 'closed'/);
    assert.match(friends, /path: `\/api\/v1\/friends\/\$\{friendshipId\}\/shared-collections\?limit=50`/);
    assert.match(friends, /<SharedCollections dictionary=\{dictionary\} friendshipId=\{friend\.friendshipId\} \/>/);
    // the fetch lives in the toggle, not in an effect that would run for every card
    const component = friends.slice(friends.indexOf('function SharedCollections'), friends.indexOf('/** 친구 추가'));
    assert.doesNotMatch(component, /useEffect/);
    assert.match(component, /const toggle = \(\) =>/);
  });

  it('each Collection is a real link to its Collection Details, with its tile, name and lock state', () => {
    const component = friends.slice(friends.indexOf('function SharedCollections'), friends.indexOf('/** 친구 추가'));
    assert.match(component, /href=\{collectionHref\(collection\.id\)\}/);
    assert.match(component, /<CollectionTileView collection=\{collection\} size=\{44\} \/>/);
    assert.match(component, /isCollectionLocked\(collection\)/);
    assert.match(component, /aria-expanded=\{open\}/);
    // the heading carries the count (with + when there is another page); empty / failure have their own words
    assert.match(component, /formatMessage\(dictionary\.friendsSharedCollectionsCount/);
    assert.match(component, /dictionary\.friendsSharedCollectionsEmpty/);
    assert.match(component, /dictionary\.friendsSharedCollectionsFailed/);
  });

  it('더 보기 reads the next page by the server cursor: one request at a time, hidden on the last page, rows kept and retry on failure', () => {
    const component = friends.slice(friends.indexOf('function SharedCollections'), friends.indexOf('/** 친구 추가'));
    assert.match(component, /shared-collections\?limit=50&cursor=\$\{encodeURIComponent\(cursor\)\}/);
    assert.match(component, /state\.nextCursor === null \|\| state\.loadingMore/, 'no second request while one runs');
    assert.match(component, /!current\.items\.some\(known => known\.id === entry\.id\)/, 'a boundary row is not shown twice');
    assert.match(component, /\{ \.\.\.current, loadingMore: false, moreFailed: true \}/, 'the loaded rows stay on a failure');
    assert.match(component, /state\.kind === 'loaded' && state\.nextCursor !== null \? \(/, 'hidden on the last page');
    assert.match(component, /disabled=\{state\.loadingMore\}/);
    assert.match(component, /state\.moreFailed \? dictionary\.retry : dictionary\.friendsSharedCollectionsMore/);
    assert.match(component, /nextCursor !== null \? '\+' : ''/);
  });

  it('the words exist in all 17 languages, with the count placeholder', () => {
    for (const language of APP_LANGUAGES) {
      const words = getAppDictionary(language);
      assert.ok(words.friendsSharedCollectionsTitle.length > 0, language);
      assert.ok(words.friendsSharedCollectionsEmpty.length > 0, language);
      assert.ok(words.friendsSharedCollectionsFailed.length > 0, language);
      assert.ok(words.friendsSharedCollectionsMore.length > 0, language);
      assert.ok(words.friendsSharedCollectionsCount.includes('{count}'), language);
      assert.ok(formatMessage(words.friendsSharedCollectionsCount, { count: 3 }).includes('3'), language);
    }
    assert.equal(formatMessage(getAppDictionary('ko').friendsSharedCollectionsCount, { count: 3 }), '함께 공유 중인 컬렉션 3');
  });
});
