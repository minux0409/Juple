import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { getAppDictionary } from '../lib/appDictionary.ts';
import { APP_LANGUAGES, formatMessage } from '../lib/appI18n.ts';

const source = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const friends = source('app/(app)/me/friends/page.tsx');

describe('Friends: 차단한 사용자 is a tab, not a separate settings page', () => {
  it('four tabs; the blocked tab mounts the panel only when open (always the server\'s current list)', () => {
    assert.match(friends, /\['blocked', dictionary\.safetyBlockedUsers, null\]/);
    assert.match(friends, /\{tab === 'blocked' \? <BlockedUsersPanel \/> : null\}/);
    assert.match(friends, /useSearchParams\(\)\.get\('tab'\) === 'blocked'/);
    // the request tabs no longer swallow it
    assert.match(friends, /\{tab === 'incoming' \|\| tab === 'outgoing' \? \(/);
  });

  it('the panel lists only the caller\'s own blocks with photo, name and 차단 해제, through the existing endpoints', () => {
    const panel = source('app/(app)/me/blocked-users/BlockedUsers.tsx');
    assert.match(panel, /export function BlockedUsersPanel/);
    assert.match(panel, /path: BLOCKED_USERS_PATH/);
    assert.match(panel, /method: 'DELETE', path: blockPath\(user\.jupleId\)/);
    assert.match(panel, /<Avatar person=/);
    assert.match(panel, /data-unblock/);
    // unblocking restores nothing: no friendship request or friend-list change is made there
    assert.doesNotMatch(panel, /friends\/requests|\/api\/v1\/friends/);
  });

  it('the old address redirects into Friends; the settings rail no longer lists it', () => {
    assert.match(source('app/(app)/me/blocked-users/page.tsx'), /redirect\('\/me\/friends\?tab=blocked'\)/);
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
    assert.match(component, /<CollectionTileView collection=\{collection\} size=\{36\} \/>/);
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
