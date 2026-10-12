import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { ApiHttpError } from '../lib/appApi.ts';
import { getAppDictionary } from '../lib/appDictionary.ts';
import { COLLECTION_SEARCH_DEBOUNCE_MS, filterCollectionsByName } from '../lib/collectionPicker.ts';
import * as unlock from '../lib/collectionUnlock.ts';

const ko = getAppDictionary('ko');
const source = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

describe('review page: Collection search and the picker box', () => {
  const collections = [
    { id: 1, name: 'Trips 2026' },
    { id: 2, name: '카페 모음' },
    { id: 3, name: 'ＷＯＲＫ notes' },
  ];

  it('filters the loaded list by name (case / full-width forms alike), an empty query shows everything', () => {
    assert.deepEqual(filterCollectionsByName(collections, 'trips').map(c => c.id), [1]);
    assert.deepEqual(filterCollectionsByName(collections, '카페').map(c => c.id), [2]);
    assert.deepEqual(filterCollectionsByName(collections, 'work').map(c => c.id), [3]);
    assert.deepEqual(filterCollectionsByName(collections, '   ').map(c => c.id), [1, 2, 3]);
    assert.deepEqual(filterCollectionsByName(collections, 'zzz'), []);
    assert.ok(COLLECTION_SEARCH_DEBOUNCE_MS >= 200 && COLLECTION_SEARCH_DEBOUNCE_MS <= 300);
  });

  it('search never changes the selection; 선택 안 함 is always first; Save sends what is selected, not what is visible', () => {
    const picker = source('app/(app)/CollectionPicker.tsx');
    const review = source('app/(app)/items/new/NewLinkReviewView.tsx');
    assert.match(picker, /setTimeout\(\(\) => setAppliedQuery\(query\), COLLECTION_SEARCH_DEBOUNCE_MS\)/);
    assert.match(picker, /filterCollectionsByName\(destinations \?\? \[\], appliedQuery\)/);
    assert.ok(picker.indexOf('{dictionary.collectionNone}') < picker.indexOf('visible.map('));
    // The review sends what is SELECTED (not what is visible), with the grants of its own picker session only.
    assert.match(review, /const noneChosen = selected\.size === 0;/);
    assert.match(review, /const collectionIds = \[\.\.\.selected\];/);
    assert.match(review, /saveInboxEntryBody\(url, clientRequestId\.current, collectionIds, unlockTokensFor\(pickerSession, collectionIds\)\)/);
    assert.doesNotMatch(picker, /setSelected\(/);
    assert.match(picker, /\{dictionary\.searchEmpty\}/);
  });

  it('about five rows are visible (four on a narrow desktop) and the rest scrolls inside the (keyboard-focusable) box; phones keep the viewport limit', () => {
    const css = source('app/(app)/app.module.css');
    // The visible rows come from the row height and gap (about 5 on a desktop, 4 below 1024px); it is only a maximum, the list scrolls inside.
    assert.match(css, /\.pickerScroll \{\s*overflow-y: auto;/);
    assert.match(css, /--picker-row-height: 66px;\s*--picker-row-gap: 8px;\s*--picker-rows: 5;\s*max-height: calc\(var\(--picker-rows\) \* var\(--picker-row-height\) \+ \(var\(--picker-rows\) - 1\) \* var\(--picker-row-gap\) \+ 10px\);/);
    assert.match(css, /@media \(max-width: 1023px\) \{\s*\.pickerScroll \{\s*--picker-rows: 4;/);
    assert.match(css, /\.choice,\s*\.choiceSelected \{\s*box-sizing: border-box;\s*min-height: var\(--picker-row-height, 66px\);/);
    assert.match(css, /@media \(max-width: 859px\) \{\s*\.pickerScroll \{\s*max-height: min\(50vh, 360px\);/);
    assert.match(source('app/(app)/CollectionPicker.tsx'), /className=\{styles\.pickerScroll\} role="group" tabIndex=\{0\}/);
  });

  it('Save is the form\'s own sticky footer (never fixed to the window); one shared header spacing rule', () => {
    const css = source('app/(app)/app.module.css');
    assert.match(css, /\.reviewFooter \{\s*position: sticky;\s*bottom: 0;/);
    assert.doesNotMatch(css, /position: fixed/);
    assert.match(css, /\.pageHeader,\s*\.detailHeader \{\s*margin-bottom: var\(--header-gap\);/);
    assert.match(source('app/(app)/ItemForm.tsx'), /className=\{styles\.reviewFooter\}/);
  });
});

describe('locked Collections on the Web', () => {
  it('the password goes once to the mobile endpoints; only the grant travels, in the unlock header, and only while held', () => {
    assert.equal(unlock.unlockPath(5, 'lock'), '/api/v1/collections/5/unlock');
    assert.equal(unlock.unlockPath(5, 'sharePassword'), '/api/v1/collections/5/share-password/unlock');
    unlock.forgetAllUnlocks();
    assert.equal(unlock.unlockHeaders(5), undefined, 'no grant, no header');
    unlock.rememberUnlock(5, { unlockToken: 'grant-5', expiresAtUtc: new Date(Date.now() + 10 * 60_000).toISOString() });
    assert.deepEqual(unlock.unlockHeaders(5), { 'X-Juple-Collection-Unlock': 'grant-5' });
    assert.equal(unlock.unlockHeaders(6), undefined, 'a grant is for its own Collection only');
  });

  it('a grant ends with the visit (leaving that Collection\'s pages), shortly before its expiry, and on sign-out', () => {
    unlock.forgetAllUnlocks();
    const later = new Date(Date.now() + 10 * 60_000).toISOString();
    unlock.rememberUnlock(5, { unlockToken: 'g5', expiresAtUtc: later });
    unlock.rememberUnlock(7, { unlockToken: 'g7', expiresAtUtc: later });
    unlock.forgetUnlocksOutside('/collections/5/items/12');
    assert.equal(unlock.unlockTokenFor(5), 'g5', 'still inside Collection 5');
    assert.equal(unlock.unlockTokenFor(7), null, 'left Collection 7');
    unlock.forgetUnlocksOutside('/collections/55');
    assert.equal(unlock.unlockTokenFor(5), null, '/collections/55 is not inside /collections/5');
    unlock.rememberUnlock(5, { unlockToken: 'soon', expiresAtUtc: new Date(Date.now() + 10_000).toISOString() });
    assert.equal(unlock.unlockTokenFor(5), null, 'treated as expired 30 s early');
    unlock.rememberUnlock(5, { unlockToken: 'g5', expiresAtUtc: later });
    unlock.forgetAllUnlocks();
    assert.equal(unlock.unlockTokenFor(5), null);
    assert.match(source('app/(app)/AppRoot.tsx'), /forgetAllUnlocks\(\);/);
    assert.match(source('app/(app)/AppShell.tsx'), /forgetUnlocksOutside\(pathname\)/);
  });

  it('the password and the grant are never persisted (memory only - no storage, cookie or IndexedDB) and never logged', () => {
    for (const path of ['lib/collectionUnlock.ts', 'lib/itemOpenGrant.ts', 'lib/pickerUnlockSession.ts', 'app/(app)/collections/[collectionId]/UnlockPanel.tsx', 'app/(app)/CollectionPicker.tsx']) {
      // Code use only (the module's own comment names these stores to say they are not used).
      assert.doesNotMatch(source(path), /\blocalStorage\.|\bsessionStorage\.|document\.cookie|indexedDB\.|\bconsole\./, path);
    }
    const panel = source('app/(app)/collections/[collectionId]/UnlockPanel.tsx');
    assert.match(panel, /rememberUnlock\(collectionId, grant\);\s*\}\s*setPassword\(''\);/, 'the typed password is dropped after success');
  });

  it('the server answers in the mobile words; a password that no longer exists is not "wrong"', () => {
    assert.equal(unlock.unlockErrorMessage(new ApiHttpError(403, 'invalidCollectionPassword'), 'lock', ko), ko.lockWrongPassword);
    assert.equal(unlock.unlockErrorMessage(new ApiHttpError(403, 'invalidCollectionPassword'), 'sharePassword', ko), ko.sharePasswordWrong);
    assert.equal(unlock.unlockErrorMessage(new ApiHttpError(429, null), 'lock', ko), ko.lockTooManyAttempts);
    assert.equal(unlock.unlockErrorMessage(new ApiHttpError(500, null), 'lock', ko), ko.lockUnlockFallback);
    assert.equal(unlock.isUnlockStateChanged(new ApiHttpError(409, 'collectionNotLocked')), true);
    assert.equal(unlock.isUnlockStateChanged(new ApiHttpError(409, 'sharePasswordNotSet')), true);
    assert.equal(unlock.isUnlockStateChanged(new ApiHttpError(409, 'somethingElse')), false);
  });

  it('a locked answer shows the password prompt in the Collection page; the content requests carry the grant, the others do not', () => {
    const details = source('app/(app)/collections/[collectionId]/CollectionDetailsView.tsx');
    assert.match(details, /\{gate \? \(\s*<UnlockPanel/);
    assert.doesNotMatch(details, /collectionLockedWebMessage/);
    for (const call of ['collectionSectionsPath(collection.id), headers: unlockHeaders(collection.id)', 'cursor), headers: unlockHeaders(collection.id)', 'collectionWholePagePath(collectionId, cursor), headers: unlockHeaders(collectionId)']) {
      assert.ok(details.includes(call), call);
    }
    assert.match(details, /\/participants` \}\)/, 'participants need no grant (membership is not content)');
    assert.match(source('app/(app)/collections/[collectionId]/items/[itemId]/SharedItemView.tsx'), /headers: unlockHeaders\(collectionId\)/);
    assert.match(source('app/(app)/collections/[collectionId]/edit/EditCollectionView.tsx'), /updateCollection\(api, collection, draft, dictionary, unlockHeaders\(collection\.id\)\)/);
  });

  it('unlocking changes no permission: 편집 stays Owner-only, and a locked one only with its grant', () => {
    const details = source('app/(app)/collections/[collectionId]/CollectionDetailsView.tsx');
    assert.match(details, /canEditCollection\(collection\) && \(!isCollectionLocked\(collection\) \|\| unlockTokenFor\(collection\.id\) !== null\)/);
  });
});
