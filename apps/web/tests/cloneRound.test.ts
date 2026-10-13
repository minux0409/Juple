import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { ApiHttpError, type AppApi, type AppApiRequest } from '../lib/appApi.ts';
import { getAppDictionary } from '../lib/appDictionary.ts';
import { createCollection } from '../lib/collectionEditor.ts';
import {
  MAX_ITEMS_PER_COPY,
  clearCloneResult,
  cloneCollection,
  cloneInitialDraft,
  copyVisibleLinks,
  peekCloneResult,
  rememberCloneResult,
} from '../lib/collectionOperations.ts';

const source = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const ko = getAppDictionary('ko');
const view = source('app/(app)/collections/[collectionId]/clone/CloneCollectionView.tsx');
const editor = source('app/(app)/collections/CollectionEditor.tsx');
const details = source('app/(app)/collections/[collectionId]/CollectionDetailsView.tsx');
const sharing = source('app/(app)/collections/[collectionId]/CollectionSharing.tsx');

function fakeApi(answers: Record<string, (request: AppApiRequest) => unknown>) {
  const calls: AppApiRequest[] = [];
  const api = (async (request: AppApiRequest) => {
    calls.push(request);
    const route = `${request.method ?? 'GET'} ${request.path.split('?')[0]}`;
    const answer = answers[route];
    if (!answer) {
      throw new Error(`unexpected ${route}`);
    }
    return answer(request);
  }) as AppApi;
  return { api, calls };
}

describe('내 컬렉션으로 복제 is the Collection editor (create / edit / clone - one form)', () => {
  it('a page of its own under the Collection, opened from the member\'s ⋯ (no small name-only dialog any more)', () => {
    assert.ok(existsSync(new URL('../app/(app)/collections/[collectionId]/clone/page.tsx', import.meta.url)));
    assert.ok(!existsSync(new URL('../app/(app)/collections/[collectionId]/CloneCollectionDialog.tsx', import.meta.url)));
    assert.ok(details.includes("onSelect: () => router.push(`${collectionHref(collection.id)}/clone`) }]"));
  });

  it('new, edit and clone render the SAME CollectionEditor - clone has no icon / colour / photo UI of its own', () => {
    for (const page of ['app/(app)/collections/new/page.tsx', 'app/(app)/collections/[collectionId]/edit/EditCollectionView.tsx', 'app/(app)/collections/[collectionId]/clone/CloneCollectionView.tsx']) {
      assert.match(source(page), /<CollectionEditor\s/, page);
    }
    assert.match(view, /mode="clone"/);
    assert.doesNotMatch(view, /iconOption|swatch|customColor|type="file"|COLLECTION_COLOR_KEYS|COLLECTION_ICON_KEYS/);
    assert.ok(editor.includes("readonly mode: 'create' | 'edit' | 'clone';"));
    assert.ok(editor.includes("mode === 'clone' ? dictionary.cloneSubmit"));
    assert.equal(ko.cloneSubmit, '복제');
    assert.equal(ko.cloneToMine, '내 컬렉션으로 복제');
  });

  it('starts from the source\'s name, glyph and the colour it really shows - never its photo (the Owner\'s stored image cannot be copied)', () => {
    assert.deepEqual(cloneInitialDraft({ id: 13, name: '여행', icon: 'Plane', color: 'Mint' }), { name: '여행', icon: 'Plane', color: 'Mint' });
    const derived = cloneInitialDraft({ id: 13, name: '여행', icon: 'unknown-icon', color: null });
    assert.equal(derived.icon, 'Folder', 'an unknown glyph falls back like everywhere else');
    assert.notEqual(derived.color, null, 'the colour the source shows, not "none"');
    assert.match(view, /initial=\{cloneInitialDraft\(collection\)\}\s*initialImageUrl=\{null\}/);
  });

  it('a member only (the Owner has 병합), and a share-password source asks its password first', () => {
    assert.match(view, /if \(!isSharedWithMe\(collection\)\) \{/);
    assert.match(view, /const gate = collectionContentGate\(collection\);\s*if \(gate && unlockTokenFor\(collection\.id\) === null\) \{/);
    assert.match(view, /onCancel=\{\(\) => router\.back\(\)\}/);
  });

  it('creates with what the person chose in the editor (name, glyph, colour, an own photo) and then copies the links', async () => {
    const { api, calls } = fakeApi({
      'POST /api/v1/collections': request => ({ id: 60, ...(request.body as object) }),
      'GET /api/v1/collections/13/items': () => ({ items: [{ itemId: 1 }, { itemId: 2 }], nextCursor: null }),
      'POST /api/v1/collections/13/items/copy': () => ({ copiedCount: 2, skippedCount: 0, unavailableCount: 0 }),
    });
    const draft = { name: ' 내 여행 ', icon: 'Book', color: 'Rose' as const, image: { kind: 'keep' as const } };
    const outcome = await cloneCollection(api, 13, () => createCollection(api, draft, ko), { 'X-Juple-Collection-Unlock': 'g' });
    assert.equal(outcome.kind, 'done');
    assert.deepEqual(calls[0].body, { name: '내 여행', icon: 'Book', color: 'Rose' });
    const copy = calls.find(call => call.path.endsWith('/items/copy'));
    assert.deepEqual(copy?.body, { destinationCollectionId: 60, itemIds: [1, 2] });
    assert.equal(copy?.headers?.['X-Juple-Collection-Unlock'], 'g');
    assert.ok(!calls.some(call => call.method === 'DELETE' || call.method === 'PUT' || /\/(merge|share|participants|invitations|comments|reaction|like)/.test(call.path)), 'nothing else copied, the source untouched');
    assert.match(view, /cloneCollection\(api, collection\.id, \(\) => createCollection\(api, draft, dictionary\), unlockHeaders\(collection\.id\)\)/);
  });

  it('a name I already use: the editor\'s own error, nothing created, nothing copied', async () => {
    const { api, calls } = fakeApi({ 'POST /api/v1/collections': () => { throw new ApiHttpError(409, 'collectionNameConflict'); } });
    const outcome = await cloneCollection(api, 13, () => createCollection(api, { name: '여행', icon: 'Folder', color: 'Blue', image: { kind: 'keep' } }, ko), undefined);
    assert.equal(outcome.kind, 'notCreated');
    if (outcome.kind === 'notCreated') {
      assert.equal(outcome.message, ko.errorNameConflict);
    }
    assert.equal(calls.length, 1);
    assert.match(view, /setError\(outcome\.message\);\s*setIsSubmitting\(false\);/);
  });

  it('copies in chunks of the server limit; a failed chunk is counted, the rest still runs, nothing is undone', async () => {
    let n = 0;
    const { api, calls } = fakeApi({
      'GET /api/v1/collections/13/items': () => ({ items: Array.from({ length: 450 }, (_, index) => ({ itemId: index + 1 })), nextCursor: null }),
      'POST /api/v1/collections/13/items/copy': request => {
        n += 1;
        if (n === 2) {
          throw new ApiHttpError(500, null);
        }
        return { copiedCount: (request.body as { itemIds: number[] }).itemIds.length, skippedCount: 0, unavailableCount: 0 };
      },
    });
    const copy = await copyVisibleLinks(api, 13, 61, undefined);
    assert.deepEqual(calls.filter(call => call.method === 'POST').map(call => (call.body as { itemIds: number[] }).itemIds.length), [MAX_ITEMS_PER_COPY, MAX_ITEMS_PER_COPY, 50]);
    assert.deepEqual(copy, { result: { copiedCount: 250, skippedCount: 0, unavailableCount: 0 }, failedChunks: 1, totalChunks: 3 });
  });

  it('the new Collection opens and says how it went - a partial copy as partial, never timed away', () => {
    assert.match(view, /rememberCloneResult\(outcome\);\s*router\.replace\(collectionHref\(outcome\.collectionId\)\);/);
    const outcome = { kind: 'done' as const, collectionId: 61, warning: null, result: { copiedCount: 2, skippedCount: 0, unavailableCount: 0 }, failedChunks: 0, totalChunks: 1 };
    rememberCloneResult(outcome, 1000);
    assert.equal(peekCloneResult(60, 1000), null);
    assert.deepEqual(peekCloneResult(61, 2000), outcome);
    assert.equal(peekCloneResult(61, 1000 + 16_000), null);
    clearCloneResult(61);
    assert.equal(peekCloneResult(61, 2000), null);
    const banner = source('app/(app)/collections/[collectionId]/CloneResultBanner.tsx');
    assert.match(banner, /data-clone-result=\{partial \? 'partial' : 'complete'\}/);
    assert.doesNotMatch(banner, /setTimeout/);
  });
});

describe('the locked Collection\'s share screen', () => {
  it('locked is its own state: the Owner\'s lock password first (UnlockPanel), never an endless skeleton', () => {
    assert.match(sharing, /const \[ownerNeedsUnlock, setOwnerNeedsUnlock\] = useState\(\(\) => !member && isCollectionLocked\(collection\) && unlockTokenFor\(collection\.id\) === null\);/);
    assert.match(sharing, /\{state\.kind === 'locked' \? \(\s*<UnlockPanel\s/);
    assert.doesNotMatch(sharing, /collectionLockedWebMessage/, 'the old "cannot open on the web" line is gone - the Web unlocks');
  });

  it('the sections that need the grant (access password, invitations) are not drawn while locked - so nothing waits for a request nobody sends', () => {
    const passwordSection = sharing.indexOf('{dictionary.sharePasswordTitle}');
    const passwordGuard = sharing.lastIndexOf('{canManage', passwordSection);
    assert.ok(sharing.slice(passwordGuard, passwordSection).startsWith('{canManage && !ownerNeedsUnlock ? ('));
    assert.match(sharing, /\{canManage && !ownerNeedsUnlock \? \(\s*<section className=\{styles\.shareSection\} data-invite>/);
    // The access-password request is skipped exactly while locked, and its skeleton only shows while that request runs.
    assert.match(sharing, /if \(member \|\| ownerNeedsUnlock\) \{\s*return undefined;/);
    assert.match(sharing, /\{passwordStatus === null \? <SettingsRowSkeleton count=\{1\} \/> : null\}/);
  });

  it('unlocking here reads the share state and the access password at once, and opens the page behind with the same grant', () => {
    assert.match(sharing, /onUnlocked=\{\(\) => \{\s*setState\(\{ kind: 'loading' \}\);\s*setOwnerNeedsUnlock\(false\);\s*onUnlocked\?\.\(\);/);
    assert.equal((sharing.match(/\}, \[ownerNeedsUnlock\]\);/g) ?? []).length, 2, 'both reads run again once unlocked');
    assert.match(details, /onUnlocked=\{\(\) => \{\s*\/\/ Unlocked from the share screen: the same grant opens the content behind it\.\s*setGate\(null\);\s*setContentToken\(token => token \+ 1\);/);
  });

  it('an unlocked / unlocked-this-visit / member Collection is unchanged: no unlock step, every section as before', () => {
    assert.match(sharing, /useState<ShareState>\(\(\) => \(ownerNeedsUnlock \? \{ kind: 'locked' \} : \{ kind: 'loading' \}\)\)/);
    assert.match(sharing, /\{canManage && \(state\.kind === 'owner' \|\| state\.kind === 'none'\) \? \(/, 'public settings as before');
    assert.match(sharing, /<IdInvite collectionId=\{collection\.id\}/);
    assert.match(sharing, /<PillListbox\s/);
  });
});
