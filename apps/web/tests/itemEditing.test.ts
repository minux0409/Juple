import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { ApiHttpError, ApiNetworkError, AuthExpiredError, createAppApi, type AppApi } from '../lib/appApi.ts';
import { getAppDictionary } from '../lib/appDictionary.ts';
import { collectionContentGate } from '../lib/collectionGate.ts';
import type { CollectionSummary } from '../lib/collectionsView.ts';
import * as unlock from '../lib/collectionUnlock.ts';
import { ownPhotoOf, representativePhotoUrl } from '../lib/itemDetails.ts';
import * as edit from '../lib/itemEdit.ts';
import * as openGrant from '../lib/itemOpenGrant.ts';
import { saveInboxEntryBody } from '../lib/newLink.ts';
import { createPickerUnlockSession, unlockTokensFor } from '../lib/pickerUnlockSession.ts';
import { historyLinkView, inCollectionContext, collectionLinkView, type ItemHistoryEntry } from '../lib/savedLinks.ts';

const ko = getAppDictionary('ko');
// Line endings normalized: a Windows checkout (core.autocrlf) has CRLF, and the block lookups below search for '\n'.
const source = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const later = () => new Date(Date.now() + 10 * 60_000).toISOString();
const collection = (id: number, extra: Partial<CollectionSummary> = {}): CollectionSummary => ({ id, name: `C${id}`, icon: 'Folder', color: null, itemCount: 0, isFavorite: false, ...extra });

/** A recording api: answers each request from `answers` (a status number, or an Error to throw) in order. */
function recordingApi(answers: Array<number | Error | { status: number; body: unknown }>) {
  const calls: { method: string; path: string; headers?: Readonly<Record<string, string>> }[] = [];
  const api = (async (request: { method?: string; path: string; headers?: Readonly<Record<string, string>> }) => {
    calls.push({ method: request.method ?? 'GET', path: request.path, headers: request.headers });
    const answer = answers[calls.length - 1] ?? 204;
    if (answer instanceof Error) {
      throw answer;
    }
    if (typeof answer === 'object') {
      return answer.body;
    }
    if (answer >= 400) {
      throw new ApiHttpError(answer, null);
    }
    return undefined;
  }) as unknown as AppApi;
  return { api, calls };
}

describe('item editing: owner-only, mobile rules', () => {
  it('Edit and delete live only on the owner page; another member\'s shared view has neither', () => {
    const details = source('app/(app)/items/[itemId]/ItemDetailContent.tsx');
    assert.match(details, /itemEditHref\(itemId, search\)/);
    // The owner page is GET /api/v1/items/{id} (404 for anyone else): the buttons exist only in its loaded state.
    assert.match(details, /state\.kind !== 'loaded' \|\| itemId === null\) \{\s*return null;/);
    const shared = source('app/(app)/collections/[collectionId]/items/[itemId]/SharedItemView.tsx');
    assert.doesNotMatch(shared, /itemEditHref|dictionary\.edit\b|method:\s*'(PUT|PATCH|DELETE|POST)'/);
    // Another member's link never reaches the editor: its href is the shared view, in that Collection.
    const theirs = collectionLinkView({ itemId: 7, url: 'https://a.test', title: 't', memo: 'private', addedAtUtc: '2026-10-10T00:00:00Z', representativeImage: null, previewImageUrl: null, coverImage: null, isMine: false }, 12);
    assert.equal(inCollectionContext(theirs, 12).href, '/collections/12/items/7');
    const mine = collectionLinkView({ itemId: 7, url: 'https://a.test', title: 't', memo: null, addedAtUtc: '2026-10-10T00:00:00Z', representativeImage: null, previewImageUrl: null, coverImage: null }, 12);
    assert.equal(inCollectionContext(mine, 12).href, '/items/7?collectionId=12');
  });

  it('title and memo: one PUT with both fields exactly as typed (the server normalizes) and the mobile error words', () => {
    assert.equal(edit.itemDetailsPath(34), '/api/v1/items/34/details');
    assert.deepEqual(edit.itemDetailsBody('  Title ', 'line1\n line2 '), { title: '  Title ', memo: 'line1\n line2 ' });
    assert.equal(edit.isItemDraftDirty({ title: 'a', memo: '' }, { title: 'a', memo: '' }), false);
    assert.equal(edit.isItemDraftDirty({ title: 'a', memo: 'x' }, { title: 'a', memo: '' }), true);
    assert.equal(edit.itemSaveErrorMessage(new ApiHttpError(400, null), ko), ko.errorInvalidInput);
    assert.equal(edit.itemSaveErrorMessage(new ApiHttpError(500, null), ko), ko.itemSaveError);
    const view = source('app/(app)/items/[itemId]/edit/ItemEditView.tsx');
    assert.match(view, /method: 'PUT', path: itemDetailsPath\(itemId\), body: itemDetailsBody\(title, memo\)/);
    // The editor cannot change the saved URL (mobile cannot either): it is shown, never an input.
    assert.doesNotMatch(view, /name="url"|setUrl|itemUrlPath/);
  });

  it('the editor route is its own page, so back / forward / refresh work', () => {
    assert.equal(edit.itemEditHref(5), '/items/5/edit');
    assert.equal(edit.itemEditHref(5, '?lockedBy=3'), '/items/5/edit?lockedBy=3');
    assert.equal(edit.itemContextSearch({ lockedBy: 3, fromCollectionId: null }), '?lockedBy=3');
    assert.equal(edit.itemContextSearch({ lockedBy: null, fromCollectionId: 8 }), '?collectionId=8');
    assert.equal(edit.itemContextSearch({ lockedBy: null, fromCollectionId: null }), '');
    assert.ok(readFileSync(new URL('../app/(app)/items/[itemId]/edit/page.tsx', import.meta.url), 'utf8').includes('ItemEditView'));
  });
});

describe('item editing: Collection assignment (mobile applyItemMembershipChanges)', () => {
  it('adds first, then removals, one request each, each Collection with its own grant', async () => {
    const { api, calls } = recordingApi([204, 204, 204]);
    const result = await edit.applyItemMembershipChanges(api, 9, [collection(1), collection(2)], [5], id => (id === 2 ? 'grant-2' : null), ko);
    assert.deepEqual(calls.map(call => `${call.method} ${call.path}`), ['PUT /api/v1/collections/1/items/9', 'PUT /api/v1/collections/2/items/9', 'DELETE /api/v1/collections/5/items/9']);
    assert.equal(calls[0].headers, undefined);
    assert.deepEqual(calls[1].headers, { 'X-Juple-Collection-Unlock': 'grant-2' });
    assert.deepEqual({ added: result.addedIds, removed: result.removedIds, failures: result.failureMessages }, { added: [1, 2], removed: [5], failures: [] });
  });

  it('a proposal (202) is not a membership; a failure never stops or undoes the rest; messages are de-duplicated', async () => {
    const { api, calls } = recordingApi([{ status: 202, body: { submitted: true } }, 403, 403, 204]);
    const result = await edit.applyItemMembershipChanges(api, 9, [collection(1), collection(2)], [3, 4], () => null, ko);
    assert.equal(calls.length, 4, 'every change is attempted');
    assert.deepEqual(result.proposedIds, [1]);
    assert.deepEqual(result.addedIds, []);
    assert.deepEqual(result.removedIds, [4]);
    assert.deepEqual(result.failureMessages, [ko.membershipError], 'three failures that read the same are said once');
  });

  it('"already there" / "already waiting" are settled (nothing more to save) and said in the mobile words', async () => {
    const answers = [new ApiHttpError(409, 'linkAlreadyInCollection'), new ApiHttpError(409, 'linkAlreadyPending')];
    const { api } = recordingApi(answers);
    const result = await edit.applyItemMembershipChanges(api, 9, [collection(1), collection(2)], [], () => null, ko);
    assert.deepEqual(result.settledIds, [1, 2]);
    assert.deepEqual(result.failureMessages, [ko.linkAlreadyInCollection, ko.linkAlreadyPending]);
  });

  it('a locked Collection without its grant is said as such; a lost session ends the whole save', async () => {
    assert.equal(edit.membershipErrorMessage(new ApiHttpError(403, 'collectionLocked'), ko), ko.lockRequiredForAction);
    assert.equal(edit.membershipErrorMessage(new ApiHttpError(403, 'sharePasswordRequired'), ko), ko.sharePasswordRequiredForAction);
    const { api } = recordingApi([new AuthExpiredError()]);
    await assert.rejects(edit.applyItemMembershipChanges(api, 9, [collection(1)], [], () => null, ko), AuthExpiredError);
  });

  it('the diff is what the save sends; only an Owner takes a link out of a shared Collection; "none" is an empty set', () => {
    const diff = edit.membershipDiff(new Set([1, 2]), [collection(2), collection(3)]);
    assert.deepEqual(diff.toAdd.map(entry => entry.id), [3]);
    assert.deepEqual(diff.toRemoveIds, [1]);
    assert.deepEqual(edit.membershipDiff(new Set([1, 2]), []).toRemoveIds, [1, 2]);
    assert.equal(edit.isRemovalOwnerOnly(collection(1, { accessRole: 'contributor' })), true);
    assert.equal(edit.isRemovalOwnerOnly(collection(1, { accessRole: 'owner' })), false);
    assert.equal(edit.isRemovalOwnerOnly(collection(1)), false);
    // A Collection the link is in is representable even when the destination list does not offer it (a view-only share).
    assert.deepEqual(edit.mergeSelectedIntoDestinations([collection(1)], [collection(1), collection(9, { accessRole: 'viewer' })]).map(entry => entry.id), [1, 9]);
  });

  it('the editor saves details first, then Collections; duplicate clicks are one save; input is kept on failure', () => {
    const view = source('app/(app)/items/[itemId]/edit/ItemEditView.tsx');
    assert.ok(view.indexOf('itemDetailsPath(itemId)') < view.indexOf('applyItemMembershipChanges(api'));
    assert.match(view, /if \(savingRef\.current \|\| !isDirty\) \{\s*return;/);
    assert.match(view, /disabled=\{saving \|\| !isDirty\}/);
    // A failed part returns before the page leaves: the typed values and the staged choice stay.
    assert.match(view, /setSaveError\(itemSaveErrorMessage\(caught, dictionary\)\);\s*return;/);
    assert.match(view, /setSaveError\(result\.failureMessages\.join\('\\n'\)\);\s*return;/);
  });
});

describe('locked Collections in the picker: three separate grant scopes, memory only', () => {
  it('the password gate follows the role: Owner = lock; a member = the share password, else the legacy lock', () => {
    assert.equal(collectionContentGate(collection(1)), null);
    assert.equal(collectionContentGate(collection(1, { isLocked: true })), 'lock');
    assert.equal(collectionContentGate(collection(1, { accessRole: 'contributor', isLocked: true, isSharePasswordProtected: true } as Partial<CollectionSummary>)), 'sharePassword');
    assert.equal(collectionContentGate(collection(1, { accessRole: 'owner', isLocked: true })), 'lock');
  });

  it('the picker session keeps a grant per Collection, forgets it shortly before expiry, and is cleared with the page', () => {
    const session = createPickerUnlockSession();
    assert.equal(session.tokenFor(5), null);
    session.remember(5, { unlockToken: 'g5', expiresAtUtc: later() });
    session.remember(6, { unlockToken: 'soon', expiresAtUtc: new Date(Date.now() + 10_000).toISOString() });
    session.remember(7, { unlockToken: 'bad', expiresAtUtc: 'not a date' });
    assert.equal(session.tokenFor(5), 'g5');
    assert.equal(session.isUnlocked(5), true);
    assert.equal(session.tokenFor(6), null, 'treated as expired 30 s early');
    assert.equal(session.tokenFor(7), null, 'a grant without a usable expiry is never kept');
    assert.deepEqual(unlockTokensFor(session, [5, 6, 8]), { 5: 'g5' }, 'only Collections that hold a grant go to the save');
    session.forget(5);
    assert.equal(session.tokenFor(5), null);
    session.remember(5, { unlockToken: 'g5', expiresAtUtc: later() });
    session.clear();
    assert.equal(session.tokenFor(5), null);
  });

  it('the scopes never borrow from each other (mobile: the picker never reads Collection-visit grants)', () => {
    unlock.forgetAllUnlocks();
    const session = createPickerUnlockSession();
    session.remember(5, { unlockToken: 'picker', expiresAtUtc: later() });
    assert.equal(unlock.unlockTokenFor(5), null, 'a picker grant is not a visit grant');
    unlock.rememberUnlock(6, { unlockToken: 'visit', expiresAtUtc: later() });
    assert.equal(session.tokenFor(6), null, 'a visit grant is not a picker grant');
    assert.equal(openGrant.itemOpenGrantFor(6, 6), null, 'nor a link-opening grant');
    unlock.forgetAllUnlocks();
  });

  it('the picker hands the grant to its session INSTEAD of the visit store, and never stores a password', () => {
    const panel = source('app/(app)/collections/[collectionId]/UnlockPanel.tsx');
    assert.match(panel, /if \(onGranted\) \{\s*onGranted\(grant\);\s*\} else \{\s*rememberUnlock\(collectionId, grant\);/);
    const picker = source('app/(app)/CollectionPicker.tsx');
    assert.match(picker, /onGranted=\{grant => session\.remember\(pending\.collection\.id, grant\)\}/);
    for (const text of [picker, source('lib/pickerUnlockSession.ts'), source('lib/itemOpenGrant.ts'), source('app/(app)/items/[itemId]/useItemRecord.ts')]) {
      assert.doesNotMatch(text, /\blocalStorage\.|\bsessionStorage\.|document\.cookie|indexedDB\.|\bconsole\./);
    }
    // The locked choice is checked against the server at the tap, not trusted from the list.
    assert.match(picker, /resolveFreshCollectionAccess\(api, collection\)/);
  });

  it('the review sends grants only for chosen locked Collections; the body keeps the mobile shape', () => {
    assert.deepEqual(saveInboxEntryBody('https://a.test', 'id-1', [3, 4], { 4: 'grant-4' }), { url: 'https://a.test', clientRequestId: 'id-1', collectionIds: [3, 4], unlockTokens: { 4: 'grant-4' } });
    assert.deepEqual(saveInboxEntryBody('https://a.test', 'id-1', []).unlockTokens, {});
    assert.equal(source('app/(app)/items/new/NewLinkReviewView.tsx').includes('collectionLockedWebMessage'), false, 'a locked Collection is no longer disabled');
  });
});

describe('locked links from Home / 보관함 open IN their Collection', () => {
  const entry = (extra: Partial<ItemHistoryEntry>): ItemHistoryEntry => ({ id: 9, url: '', title: null, memo: null, savedAtUtc: '2026-10-10T00:00:00Z', representativeImage: null, previewImageUrl: null, coverImage: null, ...extra });

  it('a gated card routes to the link IN that Collection; without a Collection it stays closed; the card shows nothing of the link', () => {
    const gated = historyLinkView(entry({ isCollectionLocked: true, collectionId: 3, collectionGate: 'lock', memo: 'never' }));
    assert.equal(gated.href, '/items/9?lockedBy=3');
    assert.deepEqual({ locked: gated.locked, title: gated.title, memo: gated.memo, site: gated.site, thumbnailUrl: gated.thumbnailUrl }, { locked: true, title: { kind: 'locked' }, memo: null, site: null, thumbnailUrl: null });
    assert.equal(historyLinkView(entry({ isCollectionLocked: true })).href, null);
    assert.equal(historyLinkView(entry({ url: 'https://a.test/x', title: 'T' })).href, '/items/9');
  });

  it('the context is parsed defensively and reads go IN the Collection (never a context-free read of a gated link)', () => {
    assert.equal(openGrant.parseLockedContext('3'), 3);
    for (const bad of ['0', '-1', 'abc', '3; drop', '', null, undefined]) {
      assert.equal(openGrant.parseLockedContext(bad), null);
    }
    const record = source('app/(app)/items/[itemId]/useItemRecord.ts');
    assert.match(record, /itemReadPath\(itemId, lockedBy\), headers/);
    assert.match(record, /itemImagesReadPath\(itemId, lockedBy\), headers/);
  });

  it('a link opening\'s grant lives only inside that link\'s pages, expires early, is per Collection, and goes on sign-out', () => {
    openGrant.clearItemOpenGrants();
    openGrant.holdItemOpenGrant(9, 3, { unlockToken: 'open-9', expiresAtUtc: later() });
    assert.equal(openGrant.itemOpenGrantFor(9, 3), 'open-9');
    assert.equal(openGrant.itemOpenGrantFor(9, 4), null, 'another Collection\'s context never uses it');
    assert.equal(openGrant.itemOpenGrantFor(10, 3), null, 'another link never uses it');
    openGrant.forgetItemOpenGrantsOutside('/items/9/edit');
    assert.equal(openGrant.itemOpenGrantFor(9, 3), 'open-9', 'the editor is inside the link\'s pages');
    openGrant.forgetItemOpenGrantsOutside('/items/99');
    assert.equal(openGrant.itemOpenGrantFor(9, 3), null, '/items/99 is not inside /items/9');
    openGrant.holdItemOpenGrant(9, 3, { unlockToken: 'soon', expiresAtUtc: new Date(Date.now() + 10_000).toISOString() });
    assert.equal(openGrant.itemOpenGrantFor(9, 3), null, 'treated as expired 30 s early');
    openGrant.holdItemOpenGrant(9, 3, { unlockToken: 'open-9', expiresAtUtc: later() });
    unlock.forgetAllUnlocks();
    assert.equal(openGrant.itemOpenGrantFor(9, 3), null, 'sign-out clears it');
    assert.match(source('app/(app)/AppShell.tsx'), /forgetItemOpenGrantsOutside\(pathname\)/);
    assert.match(source('app/(app)/AppRoot.tsx'), /forgetAllUnlocks\(\);/);
  });
});

describe('item photo (one per link, immediate, server-verified)', () => {
  it('uploads multipart "file" to the item\'s images and deletes by image id', () => {
    assert.equal(edit.itemImageUploadPath(4), '/api/v1/items/4/images');
    assert.equal(edit.itemImagePath(4, 8), '/api/v1/items/4/images/8');
    const form = edit.imageUploadForm(new Blob(['x'], { type: 'image/png' }), 'a.png');
    assert.ok(form.get('file') instanceof Blob);
    assert.equal((form.get('file') as File).name, 'a.png');
    const view = source('app/(app)/items/[itemId]/edit/ItemEditView.tsx');
    assert.match(view, /method: 'POST', path: itemImageUploadPath\(itemId\), body: imageUploadForm\(file/);
    assert.match(view, /method: 'DELETE', path: itemImagePath\(itemId, ownPhoto\.id\)/);
    // A photo change is confirmed (delete), immediate, and never staged with 저장.
    assert.match(view, /open=\{confirmingPhotoDelete\}/);
  });

  it('mirrors only the server\'s own limits: not empty, 10 MB at most; the format is the server\'s call', () => {
    assert.equal(edit.MAX_ITEM_IMAGE_BYTES, 10 * 1024 * 1024);
    assert.equal(edit.isUploadableImage({ size: 0 }), false);
    assert.equal(edit.isUploadableImage({ size: edit.MAX_ITEM_IMAGE_BYTES }), true);
    assert.equal(edit.isUploadableImage({ size: edit.MAX_ITEM_IMAGE_BYTES + 1 }), false);
    assert.equal(edit.ITEM_IMAGE_ACCEPT, 'image/jpeg,image/png,image/webp');
    assert.equal(edit.imageUploadErrorMessage(new ApiHttpError(400, null), ko), ko.imageUploadInvalid);
    assert.equal(edit.imageUploadErrorMessage(new ApiNetworkError(), ko), ko.imageUploadNetwork);
    assert.equal(edit.imageUploadErrorMessage(new ApiHttpError(500, null), ko), ko.imageUploadFailed);
  });

  it('the 대표 사진 stays: own cover, else the first own photo, else the automatic preview, else nothing', () => {
    const images = [{ id: 1, readUrl: 'https://b.test/1.jpg' }, { id: 2, readUrl: 'https://b.test/2.jpg' }];
    assert.equal(representativePhotoUrl('https://p.test/p.jpg', images, 2), 'https://b.test/2.jpg');
    assert.equal(representativePhotoUrl('https://p.test/p.jpg', images, null), 'https://b.test/1.jpg');
    assert.equal(ownPhotoOf(images, 2)?.id, 2);
    assert.equal(ownPhotoOf(images, undefined)?.id, 1);
    // After the photo is deleted: the preview, then no picture at all (the site badge is drawn - never a broken <img>).
    assert.equal(representativePhotoUrl('https://p.test/p.jpg', [], null), 'https://p.test/p.jpg');
    assert.equal(representativePhotoUrl(null, [], null), null);
    assert.equal(ownPhotoOf([], null), null);
    assert.equal(representativePhotoUrl('javascript:alert(1)', [], null), null);
  });

  it('an upload is retried once with a fresh token on 401 (the body is rebuilt, never lost)', async () => {
    const seen: { auth: string | null; isForm: boolean }[] = [];
    const tokens = ['t1', 't2'];
    const api = createAppApi({
      apiBaseUrl: 'http://api.test',
      getAccessToken: async () => tokens.shift() ?? null,
      fetchImpl: async (_input, init) => {
        seen.push({ auth: ((init?.headers ?? {}) as Record<string, string>).Authorization ?? null, isForm: init?.body instanceof FormData });
        return seen.length === 1 ? new Response(null, { status: 401 }) : new Response(JSON.stringify({ id: 5, readUrl: 'https://b.test/5.jpg' }), { status: 201 });
      },
    });
    const uploaded = await api<{ id: number }>({ method: 'POST', path: '/api/v1/items/4/images', body: edit.imageUploadForm(new Blob(['x']), 'a.png') });
    assert.equal(uploaded.id, 5);
    assert.deepEqual(seen, [{ auth: 'Bearer t1', isForm: true }, { auth: 'Bearer t2', isForm: true }]);
  });
});

describe('deleting a link goes to 삭제 이력', () => {
  it('asks first, then DELETE /api/v1/items/{id} - never the permanent endpoint, never from this page', () => {
    const details = source('app/(app)/items/[itemId]/ItemDetailContent.tsx');
    assert.match(details, /<ConfirmDialog/);
    assert.match(details, /onClick=\{\(\) => setConfirming\(true\)\}/, 'the button only opens the question');
    assert.match(details, /api<void>\(\{ method: 'DELETE', path: `\/api\/v1\/items\/\$\{itemId\}` \}\)/);
    assert.doesNotMatch(details, /\/permanent|emptyTrash|items\/trash/);
    assert.doesNotMatch(source('app/(app)/items/[itemId]/edit/ItemEditView.tsx'), /\/permanent|method: 'DELETE', path: `\/api\/v1\/items\/\$\{itemId\}`/);
    assert.equal(ko.itemDeleteConfirmTitle, '링크를 삭제할까요?');
    assert.equal(ko.itemDeleteConfirmMessage, '삭제한 링크는 삭제 이력에서 복구할 수 있어요.');
  });

  it('from inside a Collection it is 컬렉션에서 삭제: only that membership goes, with that Collection\'s visit grant if held', () => {
    const details = source('app/(app)/items/[itemId]/ItemDetailContent.tsx');
    assert.match(details, /method: 'DELETE', path: `\/api\/v1\/collections\/\$\{fromCollectionId\}\/items\/\$\{itemId\}`, headers: unlockHeaders\(fromCollectionId\)/);
    assert.equal(ko.unlinkConfirmTitle, '컬렉션에서 제거할까요?');
  });

  it('삭제 이력 still restores through the same endpoint (regression)', () => {
    const trash = source('app/(app)/me/trash/page.tsx');
    assert.match(trash, /method: 'POST', path: `\/api\/v1\/items\/\$\{action\.id\}\/restore`/);
    assert.match(trash, /method: 'DELETE', path: `\/api\/v1\/items\/\$\{action\.id\}\/permanent`/);
  });
});

describe('leaving the editor with unsaved changes', () => {
  it('asks in the mobile words; 취소 and 뒤로 go through the same question; reload uses the browser\'s own prompt only', () => {
    const view = source('app/(app)/items/[itemId]/edit/ItemEditView.tsx');
    assert.match(view, /const requestLeave = \(\) => \{\s*if \(isDirty && !savingRef\.current\) \{\s*setConfirmingLeave\(true\);/);
    assert.match(view, /onClick=\{requestLeave\}/);
    assert.match(view, /window\.addEventListener\('beforeunload', warn\)/);
    assert.match(view, /cancelLabel=\{dictionary\.continueEditing\}/);
    assert.equal(ko.unsavedChangesTitle, '저장하지 않은 변경 사항');
    assert.equal(ko.continueEditing, '계속 편집');
    assert.equal(ko.leave, '나가기');
  });
});

describe('새 링크 and 링크 수정 are one form family', () => {
  const views = {
    new: source('app/(app)/items/new/NewLinkReviewView.tsx'),
    edit: source('app/(app)/items/[itemId]/edit/ItemEditView.tsx'),
  };
  const shared = source('app/(app)/ItemForm.tsx');

  it('both are built from the same layout pieces, in the same order: top card, Collections, memo, footer', () => {
    for (const [name, view] of Object.entries(views)) {
      const order = ['<ItemFormLayout', '<ItemFormTop', '</ItemFormTop>', '<ItemFormSections>', '<ItemCollectionsSection', '<ItemMemoSection', '<ItemFormFooter>'].map(marker => view.indexOf(marker));
      assert.ok(order.every(position => position >= 0), `${name} uses every shared piece`);
      assert.deepEqual([...order].sort((a, b) => a - b), order, `${name}: the pieces come in the family order`);
    }
  });

  it('there is ONE picker and ONE memo field: the views never carry their own markup', () => {
    for (const [name, view] of Object.entries(views)) {
      assert.doesNotMatch(view, /<CollectionPicker|<textarea|styles\.choice|styles\.pickerScroll|styles\.itemEditor|styles\.editFooter/, name);
    }
    assert.equal(shared.match(/<CollectionPicker /g)?.length, 1);
    assert.match(shared, /<textarea className=\{styles\.textArea\}[\s\S]*?rows=\{3\}/);
  });

  it('Collections and memo are outside the metadata column (a full-width card of their own)', () => {
    const top = shared.slice(shared.indexOf('export function ItemFormTop'), shared.indexOf('export function ItemFormSections'));
    assert.doesNotMatch(top, /CollectionPicker|<textarea/);
    const edit = views.edit;
    assert.ok(edit.indexOf('</ItemFormTop>') < edit.indexOf('<ItemCollectionsSection'));
    assert.ok(edit.indexOf('<ItemCollectionsSection') < edit.indexOf('<ItemMemoSection'), 'memo comes after Collections');
    assert.ok(edit.indexOf('<ItemMemoSection') < edit.indexOf('<ItemFormFooter>'));
    // The photo and its actions are inside the top card's media cell, not a column of their own.
    assert.ok(edit.indexOf('<ItemFormTop') < edit.indexOf('styles.photoActions') && edit.indexOf('styles.photoActions') < edit.indexOf('</ItemFormTop>'));
  });

  it('the editor starts with the link\'s current Collections selected; the footer is 취소 + 저장 (new: 저장)', () => {
    assert.match(views.edit, /const selected = staged \?\? memberships \?\? EMPTY_COLLECTIONS;/);
    assert.match(views.edit, /<ItemFormFooter>\s*<button className=\{styles\.settingsAction\}[^>]*onClick=\{requestLeave\}/);
    assert.doesNotMatch(views.new, /onClick=\{requestLeave\}/);
    assert.match(views.new, /<ItemFormFooter>\s*<button className=\{styles\.primaryAction\}/);
  });

  it('one width and one spacing: the same cards and the same wide token; narrow windows stack', () => {
    const css = source('app/(app)/app.module.css');
    assert.match(css, /\.reviewSections \{[^}]*max-width: var\(--content-wide\);/);
    assert.match(css, /\.reviewTop \{[^}]*max-width: var\(--content-wide\);/);
    assert.match(css, /\.itemForm \{\s*display: flex;\s*flex-direction: column;\s*gap: var\(--page-gap\);/);
    assert.match(css, /@media \(max-width: 860px\) \{[\s\S]*?\.reviewTop \{\s*grid-template-columns: minmax\(0, 1fr\);/);
    assert.doesNotMatch(css, /\.itemEditor|\.editFooter/);
  });
});

describe('design consistency: page header, form spacing, tokens', () => {
  const css = source('app/(app)/app.module.css');
  const header = source('app/(app)/PageHeader.tsx');

  it('one PageHeader: title (+ subtitle) at the start, page actions and the bell at the end of the same row', () => {
    assert.match(header, /<header className=\{styles\.pageHeader\}>/);
    assert.match(header, /styles\.pageHeaderActions/);
    assert.match(header, /\{actions\}\s*\{bell \? <NotificationBell \/> : null\}/);
    // The primary pages use it (bell on); the editors turn the bell off.
    for (const page of ['HomeView.tsx', 'archive/ArchiveView.tsx', 'collections/CollectionsView.tsx', 'me/SettingsPage.tsx', 'notifications/NotificationsView.tsx']) {
      const text = source(`app/(app)/${page}`);
      assert.match(text, /<PageHeader/, page);
      assert.doesNotMatch(text, /styles\.pageHeader\b|styles\.pageTitle/, `${page} has no private header markup`);
    }
    for (const page of ['items/new/NewLinkReviewView.tsx', 'items/[itemId]/edit/ItemEditView.tsx']) {
      assert.match(source(`app/(app)/${page}`), /<PageHeader bell=\{false\}/, page);
    }
  });

  it('the bell sits in the header row: the title row is as tall as the bell, nothing is fixed, absolute or in a corner', () => {
    assert.match(css, /\.pageTitle \{[^}]*line-height: 40px;/);
    assert.match(css, /\.bellButton \{[^}]*width: 40px;\s*height: 40px;/);
    const bellRule = css.slice(css.indexOf('.bellWrap {'), css.indexOf('.bellButton {'));
    assert.match(bellRule, /position: relative;/);
    assert.doesNotMatch(bellRule, /position: (fixed|absolute)/);
    assert.doesNotMatch(source('app/(app)/AppShell.tsx'), /NotificationBell/);
    // Detail pages share the back row with it.
    assert.match(source('app/(app)/items/[itemId]/ItemDetailsView.tsx'), /<BackRow>/);  // the standalone page
    assert.match(source('app/(app)/collections/[collectionId]/CollectionDetailsView.tsx'), /<BackRow>/);
  });

  it('the unread count is cleared with the shell, not with whichever page header mounted the bell', () => {
    assert.match(source('app/(app)/AppShell.tsx'), /useEffect\(\(\) => \(\) => resetUnreadCount\(\), \[\]\);/);
    assert.doesNotMatch(source('app/(app)/notifications/NotificationBell.tsx'), /resetUnreadCount/);
  });

  it('Collections: title (owns its 24px) -> search -> tiles in one section, no fieldset legend; New and Edit share it', () => {
    const form = source('app/(app)/ItemForm.tsx');
    assert.match(form, /<section aria-labelledby=\{headingId\} className=\{styles\.itemCollectionsSection\}>\s*<h2 className=\{styles\.itemFormSectionTitle\}/);
    assert.doesNotMatch(form, /<fieldset|<legend/);
    assert.match(css, /\.itemFormSectionTitle \{\s*margin: 0 0 var\(--form-title-gap\);/);
    assert.match(css, /--form-title-gap: 24px;/);
    assert.match(css, /\.collectionPicker \{\s*display: flex;\s*flex-direction: column;\s*gap: var\(--space-3\);/);
    assert.match(css, /--section-gap: 24px;/);
    // Blocks of the one shared card are --form-block-gap apart (>= 28px) on New and Edit alike.
    assert.match(css, /\.reviewSections \{[^}]*gap: var\(--form-block-gap\);/);
  });


  it('one spacing scale, one field height, one type scale', () => {
    for (const token of ['--space-1: 4px', '--space-2: 8px', '--space-3: 12px', '--space-4: 16px', '--space-5: 24px', '--space-6: 32px', '--field-height: 44px', '--text-page-title: 28px', '--text-label: 14px']) {
      assert.ok(css.includes(token), token);
    }
    assert.match(css, /\.textInput,\s*\.textArea \{[^}]*min-height: var\(--field-height\);/);
    assert.doesNotMatch(css, /min-height: 42px;/);
    assert.match(css, /\.fieldLabel,\s*\.editorLegend \{[^}]*font-size: var\(--text-label\);/);
  });

  it('Home: the main and side columns start at the same top; the summary is one card of cells', () => {
    assert.match(css, /\.dashboard \{[^}]*align-items: start;/);
    assert.match(css, /\.summaryGrid \{[^}]*border: 1px solid var\(--app-border\);[^}]*border-radius: var\(--radius-card\);/);
  });

  it('Collections: grid cards are picture-first (a cover on top), at least 220px wide', () => {
    assert.match(css, /\.collectionGrid \{[^}]*minmax\(220px, 1fr\)/);
    assert.match(css, /\.collectionCover \.collectionTile \{[^}]*aspect-ratio: 4 \/ 3;/);
  });
});

describe('Web V2: the mobile design language (theme/tokens.ts) as one token layer', () => {
  const css = source('app/(app)/app.module.css');
  const block = (selector: string) => css.slice(css.indexOf(`${selector} {`), css.indexOf('\n}', css.indexOf(`${selector} {`)));

  it('colors are the mobile values: background, surface, soft border, secondary text, brand, danger, favorite', () => {
    const tokens = css.slice(css.indexOf('.shell,'), css.indexOf('@media (prefers-color-scheme: dark)'));
    for (const value of ['--app-background: #f7f9fc', '--app-surface: #ffffff', '--app-surface-muted: #f1f4f9', '--app-text: #111111', '--app-text-secondary: #666666', '--app-border: #dde4ef', '--app-divider: #edf1f7', '--brand: #3366cc', '--brand-soft: #e9f0fe', '--danger: #b42318', '--warning: #f5a623']) {
      assert.ok(tokens.includes(value), value);
    }
    for (const name of ['--juple-bg', '--surface', '--surface-soft', '--text', '--text-secondary', '--border', '--favorite', '--radius-sm', '--radius-md', '--radius-lg', '--radius-xl', '--space-7', '--space-8', '--shadow-card', '--shadow-floating']) {
      assert.ok(tokens.includes(`${name}:`), name);
    }
  });

  it('shape: cards 20px (mobile radii.lg), inputs 14, large actions 16, segmented 12', () => {
    assert.match(css, /--radius-xl: 20px;/);
    assert.match(css, /--radius-card: var\(--radius-xl\);/);
    assert.match(css, /--radius-input: 14px;/);
    assert.match(css, /--radius-lg: 16px;/);
    assert.match(css, /--radius-md: 12px;/);
    assert.match(block('.primaryAction,\n.dangerAction'), /border-radius: var\(--radius-lg\);/);
    assert.match(block('.textInput,\n.textArea'), /min-height: var\(--field-height\);/);
  });

  it('every switch is one segmented family: sort, list/grid/image, collection filters and friends tabs', () => {
    const container = block('.filterTabs,\n.sortChips');
    const toggle = block('.toggle');
    for (const text of [container, toggle]) {
      assert.match(text, /padding: 4px;/);
      assert.match(text, /border-radius: var\(--radius-md\);/);
      assert.match(text, /background: var\(--surface-soft\);/);
    }
    const selected = block('}\n\n.filterTabSelected');
    assert.match(selected, /border-color: var\(--brand\);[\s\S]*background: var\(--brand-soft\);[\s\S]*color: var\(--brand\);/);
    assert.match(block('}\n\n.toggleButtonSelected'),/border-color: var\(--brand\);[\s\S]*background: var\(--brand-soft\);[\s\S]*color: var\(--brand\);/);
    // one component per switch kind, shared by every screen that has it
    for (const page of ['archive/ArchiveView.tsx', 'DateSections.tsx', 'HomeView.tsx', 'collections/CollectionsView.tsx']) {
      assert.doesNotMatch(source(`app/(app)/${page}`), /styles\.toggle\b|styles\.toggleButton/, page);
    }
  });

  it('the primary pages open with an icon + title header, using the mobile glyphs', () => {
    const icons: Record<string, string> = {
      'HomeView.tsx': 'Home',
      'archive/ArchiveView.tsx': 'Archive',
      'collections/CollectionsView.tsx': 'Folder',
      'me/friends/page.tsx': 'People',
      'me/trash/page.tsx': 'Trash',
      'notifications/NotificationsView.tsx': 'Bell',
    };
    for (const [page, glyph] of Object.entries(icons)) {
      assert.match(source(`app/(app)/${page}`), new RegExp(`icon="${glyph}"`), page);
    }
    assert.match(source('app/(app)/PageHeader.tsx'), /styles\.pageTitleIcon/);
  });

  it('Collections GRID is picture-first: a cover with the favorite star on its corner; LIST keeps the row', () => {
    const view = source('app/(app)/collections/CollectionsView.tsx');
    assert.match(view, /layout=\{viewMode === 'grid' \? 'grid' : 'list'\}/);
    assert.match(view, /<CollectionTileView collection=\{collection\} fill size=\{96\} \/>/);
    assert.match(view, /styles\.coverStar/);
    assert.match(css, /\.coverStar \{[^}]*position: absolute;/);
  });
});

describe('Web V2 pass 2: shared pieces the rendered screens rely on', () => {
  const css = source('app/(app)/app.module.css');

  it('picker tiles, icon tiles and swatches are large and rounded (picture / icon first), one shape', () => {
    assert.match(css, /\.choice,\s*\.choiceSelected \{[^}]*min-height: 56px;[^}]*border-radius: var\(--radius-lg\);/);
    assert.match(css, /\.iconOption,\s*\.iconOptionSelected \{[^}]*height: 56px;/);
    assert.match(css, /\.swatch,\s*\.swatchSelected \{[^}]*width: 40px;/);
    assert.match(source('app/(app)/CollectionPicker.tsx'), /<CollectionTileView collection=\{collection\} size=\{48\} \/>/);
  });

  it('no group rule was overwritten by its selected state: a plain tile / tab / toggle is not drawn as selected', () => {
    for (const group of ['.choice,\n.choiceSelected', '.filterTab,\n.filterTabSelected', '.toggleButton,\n.toggleButtonSelected']) {
      const start = css.indexOf(`\n${group} {`);
      const body = css.slice(start, css.indexOf('\n}', start));
      assert.doesNotMatch(body, /var\(--brand-soft\)/, group);
    }
  });

  it('a legend in the collection editor is spaced by its own margin; sections keep distinct gaps', () => {
    assert.match(css, /\.editorSection \.editorLegend \{\s*display: block;\s*margin: 0 0 var\(--space-3\);/);
    assert.match(css, /\.editorSection \.photoActions \{\s*margin-bottom: var\(--space-3\);/);
  });

  it('profile edit (the page 설정 opens on): an avatar, a large field, a read-only surface and one large Save, directly on the page', () => {
    const page = source('app/(app)/me/ProfileEditView.tsx');
    assert.match(page, /styles\.profileEditAvatar/);
    assert.match(page, /styles\.profileEditReadOnly/);
    assert.match(css, /\.profileEditActions \.primaryAction \{\s*min-width: 160px;/);
    assert.match(css, /\.profileEditCard \{\s*max-width: none;\s*padding: 0;\s*border: 0;/);
  });
});

describe('Web V2 completion: archive search, share screen, friend picker, rail, gallery', () => {
  const css = source('app/(app)/app.module.css');

  it('보관함 검색: the server\'s q, 2+ characters, debounced, flat list in the chosen order, never with a date window', async () => {
    const archive = await import('../lib/archiveView.ts');
    assert.equal(archive.normalizeArchiveQuery(' a '), null);
    assert.equal(archive.normalizeArchiveQuery('  ab '), 'ab');
    assert.equal(archive.ARCHIVE_SEARCH_DEBOUNCE_MS, 300);
    const path = new URL(`http://x${archive.archiveFlatPagePath({ term: '맛집', sort: 'time', cursor: null })}`);
    assert.equal(path.pathname, '/api/v1/items/history');
    assert.equal(path.searchParams.get('q'), '맛집');
    assert.equal(path.searchParams.get('sort'), null);
    assert.equal(path.searchParams.get('fromUtc'), null);
    const named = new URL(`http://x${archive.archiveFlatPagePath({ term: null, sort: 'name', cursor: 'c1' })}`);
    assert.deepEqual([named.searchParams.get('sort'), named.searchParams.get('cursor'), named.searchParams.get('q')], ['name', 'c1', null]);
    const view = source('app/(app)/archive/ArchiveView.tsx');
    assert.match(view, /<SearchField onChange=\{setText\} placeholder=\{dictionary\.archiveSearchPlaceholder\}/);
    assert.match(view, /key=\{`\$\{sort\}\|\$\{term \?\? ''\}`\}/, 'a new term / order starts over: an older answer can never land on a newer query');
    assert.match(view, /window\.history\.replaceState/, 'the term lives in the address: back / forward / reload return to it');
    assert.match(view, /term !== null \? dictionary\.searchEmpty : dictionary\.archiveEmpty/);
  });

  it('친구 초대: POST invitations with the unlock grant, one request per picked friend; failures are named and stay picked', async () => {
    const invite = await import('../lib/collectionInvite.ts');
    assert.equal(invite.invitationsPath(5), '/api/v1/collections/5/invitations');
    const friends = new URL(`http://x${invite.friendPickerPath(' 민 ', 'cur')}`);
    assert.deepEqual([friends.pathname, friends.searchParams.get('query'), friends.searchParams.get('cursor')], ['/api/v1/friends', '민', 'cur']);
    const unavailable = invite.unavailableFriends({ participants: [{ jupleId: 'a', displayName: null, role: 'owner' }], pendingInvitations: [{ invitationId: 1, jupleId: 'b', role: 'viewer' }], canManage: true });
    assert.deepEqual([unavailable.get('a'), unavailable.get('b'), unavailable.get('c')], ['member', 'pending', undefined]);
    assert.equal(invite.inviteErrorMessage(new ApiHttpError(409, 'alreadyCollaborator'), ko), ko.inviteAlreadyCollaborator);
    assert.equal(invite.inviteErrorMessage(new ApiHttpError(409, 'invitationPending'), ko), ko.inviteAlreadyPending);
    assert.equal(invite.inviteErrorMessage(new ApiHttpError(500, null), ko), ko.inviteFallback);
    const picker = source('app/(app)/collections/[collectionId]/FriendPicker.tsx');
    assert.match(picker, /method: 'POST', path: invitationsPath\(collectionId\), body: \{ jupleId: friend\.jupleId, role \}, headers: unlockHeaders\(collectionId\)/);
    assert.match(picker, /for \(const friend of picked\.values\(\)\) \{\s*try \{\s*await api/, 'one after another, never in parallel');
    assert.match(picker, /formatMessage\(dictionary\.addSelectedFriends, \{ count: picked\.size \}\)/);
    // Only the Owner (canManage) is offered it.
    assert.match(source('app/(app)/collections/[collectionId]/CollectionSharing.tsx'), /const canManage = participants\?\.canManage === true && !member;/);
  });

  it('공유 화면: one workspace - settings left (divided sections), people right; below 1100px the people go underneath; the friend picker scrolls inside', () => {
    const sharing = source('app/(app)/collections/[collectionId]/CollectionSharing.tsx');
    for (const title of ['dictionary.sharePublicTitle', 'dictionary.sharePasswordTitle', 'dictionary.friendInviteTitle', 'dictionary.participantsTitle']) {
      assert.ok(sharing.includes(`{${title}}`), title);
    }
    assert.match(css, /\.shareWorkspace \{[^}]*grid-template-columns: minmax\(0, 1\.25fr\) minmax\(300px, 1fr\);/);
    assert.match(css, /@media \(max-width: 1100px\) \{\s*\.shareWorkspace \{\s*grid-template-columns: minmax\(0, 1fr\);/);
    assert.match(css, /\.shareSection \+ \.shareSection \{[^}]*border-top: 1px solid/);
    assert.match(css, /\.friendPickerDialog \{[^}]*max-height: min\(86vh, 820px\);/);
    assert.match(css, /\.friendPickList \{[^}]*overflow-y: auto;/);
    assert.match(source('app/(app)/collections/[collectionId]/CollectionDetailsView.tsx'), /title=\{dictionary\.shareLinkTitle\} wide>/);
  });

  it('홈 rail: summary, quick actions and favorites are ONE divided surface', () => {
    assert.match(source('app/(app)/HomeView.tsx'), /<aside className=\{`\$\{styles\.dashboardSide\} \$\{styles\.railCard\}`\}>/);
    assert.match(css, /\.railCard > \* \+ \* \{[^}]*border-top: 1px solid/);
    assert.match(css, /\.railCard \.summaryGrid,\s*\.railCard \.surfaceSection \{[^}]*border: 0;[^}]*box-shadow: none;/);
  });

  it('이미지 모드 is a gallery: tiles almost touching, no border, still one hover / focus target each', () => {
    assert.match(css, /\.imageGrid \{\s*gap: 6px;/);
    assert.match(css, /\.imageTile \{\s*border: 0;/);
    assert.match(css, /@media \(max-width: 860px\) \{\s*\.imageGrid \{\s*gap: 2px;/);
  });

  it('컬렉션 cards: no reserved second line in the grid; list status icons are centered on the row', () => {
    assert.match(css, /\.collectionBodyGrid \.collectionName \{\s*min-height: 0;/);
    assert.match(css, /\.collectionBody \.cardStatus \{\s*align-self: center;\s*justify-content: center;/);
  });

  it('secondary pages (with a 뒤로) carry no bell; primary destinations do', () => {
    assert.match(source('app/(app)/me/SettingsPage.tsx'), /bell=\{backHref === null\}/);
  });
});

describe('Web V3: desktop-native layout (the window is used)', () => {
  const css = source('app/(app)/app.module.css');

  it('the shell and page widths use a wide window: 240px side bar, content up to 1680px, purpose widths 900 / 1280 / 1640', () => {
    assert.match(css, /--sidebar-width: 240px;/);
    assert.match(css, /--page-max: 1680px;/);
    assert.match(css, /--content-narrow: 900px;[\s\S]*--content-medium: 1280px;[\s\S]*--content-wide: 1640px;/);
    assert.match(css, /\.shell \{[^}]*grid-template-columns: var\(--sidebar-width\) minmax\(0, 1fr\);/);
    assert.match(css, /\.navLink,\s*\.navLinkActive \{[^}]*min-height: 48px;/);
  });

  it('Home: quick save across the whole width, then the workspace beside a fixed-width rail', () => {
    const home = source('app/(app)/HomeView.tsx');
    assert.ok(home.indexOf('<AddLinkForm />') < home.indexOf('className={styles.dashboard}'));
    assert.match(css, /\.dashboard \{[^}]*grid-template-columns: minmax\(0, 1fr\) minmax\(340px, 400px\);/);
  });

  it('link rows are table rows: picture | title | memo | when / where - the time and site have their own column', () => {
    const list = source('app/(app)/SavedLinkList.tsx');
    assert.match(list, /styles\.linkMetaCol/);
    // V4: the memo is under the title (never its own column); the row is divided, not a card.
    assert.doesNotMatch(css, /grid-template-areas: 'thumb title memo meta';/);
    assert.match(css, /\.linkList > \.linkCard \{\s*border: 0;\s*border-bottom: 1px solid var\(--border-subtle\);/);
    assert.match(css, /\.linkGrid \{\s*grid-template-columns: repeat\(auto-fill, minmax\(260px, 1fr\)\);/);
    assert.match(css, /\.collectionGrid \{\s*grid-template-columns: repeat\(auto-fill, minmax\(280px, 1fr\)\);/);
  });

  it('Archive: one bar - the search takes the room, sort and view switches sit at its end', () => {
    const view = source('app/(app)/archive/ArchiveView.tsx');
    assert.match(view, /<div className=\{styles\.archiveBar\}>\s*<SearchField[\s\S]*?<div className=\{styles\.archiveBarSwitches\}>/);
    assert.match(css, /\.archiveBar \.pickerSearch \{\s*flex: 1 1 auto;/);
  });

  it('a link\'s page: preview (7) and a sticky facts panel (5) - no 1040px card in the middle', () => {
    assert.match(css, /\.itemDetail \{\s*max-width: none;\s*grid-template-columns: minmax\(0, 7fr\) minmax\(360px, 5fr\);/);
    assert.match(css, /\.itemDetail \.itemInfo \{\s*position: sticky;/);
  });

  it('the editor: picture (about 43%, at most 576px) beside the top-aligned fields, pickers across the full width in readable tiles', () => {
    assert.match(css, /\.reviewTop \{\s*grid-template-columns: minmax\(0, min\(43%, 576px\)\) minmax\(0, 1fr\);\s*column-gap: 24px;\s*align-items: start;\s*max-width: none;/);
    // the picture is one 16:10 frame sized by its column - never a height cap that flattens it into a banner
    assert.match(css, /\.reviewTop \.itemMedia \{\s*width: 100%;\s*aspect-ratio: 16 \/ 10;\s*\}/);
    assert.doesNotMatch(css, /\.reviewTop \.itemMedia \{[^}]*max-height/);
    // a narrower window stacks the picture (and its photo buttons) above the fields, at most 576px wide
    assert.match(css, /@media \(max-width: 959px\) \{\s*\.reviewTop \{\s*grid-template-columns: minmax\(0, 1fr\);[^}]*\}\s*\.reviewTop \.photoWorkspace \{\s*max-width: 576px;/);
    assert.match(css, /\.choiceList \{\s*grid-template-columns: repeat\(auto-fill, minmax\(220px, 1fr\)\);/);
  });

  it('친구: two columns of cards', () => {
    assert.match(source('app/(app)/me/friends/page.tsx'), /styles\.friendCards/);
    assert.match(css, /\.friendCards \{\s*display: grid;\s*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\);/);
  });

  it('Collections list: two columns of wide rows on a wide window; the picture is 72px', () => {
    assert.match(css, /@media \(min-width: 1500px\) \{\s*\.collectionList \{\s*display: grid;\s*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\);/);
    assert.match(source('app/(app)/collections/CollectionsView.tsx'), /<CollectionTileView collection=\{collection\} size=\{72\} \/>/);
  });
});

describe('Web V4: a content workspace', () => {
  const css = source('app/(app)/app.module.css');

  it('New Link starts on 선택 안 함: choosing a Collection leaves it, clearing them all returns to it; Save is always available', () => {
    const review = source('app/(app)/items/new/NewLinkReviewView.tsx');
    assert.match(review, /useState<ReadonlySet<number>>\(new Set\(\)\)/, 'nothing chosen at the start');
    assert.match(review, /const noneChosen = selected\.size === 0;/, 'the none state is exactly "nothing chosen"');
    assert.match(review, /noneSelected=\{noneChosen\}/);
    assert.match(review, /onNone=\{\(\) => setSelected\(new Set\(\)\)\}/);
    assert.match(review, /disabled=\{isSaving\} type="submit"/);
    assert.doesNotMatch(review, /hasDecision|setNoneChosen/);
    // Edit starts from the link's own memberships (unchanged).
    assert.match(source('app/(app)/items/[itemId]/edit/ItemEditView.tsx'), /const selected = staged \?\? memberships \?\? EMPTY_COLLECTIONS;/);
  });

  it('link rows: the title is one line (ellipsis), the memo is the line under it, when / where is at the end - no memo column', () => {
    assert.match(css, /\.linkRowBody \.linkTitle \{\s*display: block;\s*overflow: hidden;\s*white-space: nowrap;\s*text-overflow: ellipsis;/);
    assert.match(css, /\.linkRowBody \{\s*grid-template-columns: auto minmax\(0, 1fr\) auto;\s*grid-template-areas: 'thumb text meta';/);
    assert.doesNotMatch(css, /grid-area: memo;/);
    const list = source('app/(app)/SavedLinkList.tsx');
    // The memo is rendered inside the text block, directly after the title.
    assert.match(list, /styles\.linkTitle[\s\S]*?link\.memo \? \([\s\S]*?styles\.linkMemo/);
    // Grid cards show the memo too (one line) and both modes draw the site with its badge.
    assert.match(list, /<SiteMeta link=\{link\} \/>/);
    assert.match(css, /\.linkGrid \.linkTitle \{[^}]*-webkit-line-clamp: 2;/);
    assert.match(css, /\.linkGrid \.linkMemo \{[^}]*white-space: nowrap;/);
    assert.match(css, /\.linkList > \.linkCard \{\s*border: 0;\s*border-bottom: 1px solid var\(--border-subtle\);\s*border-radius: 0;\s*background: transparent;/);
  });

  it('Item Detail with a picture: a 180px thumbnail beside title / site / open icon, then grouped rows - one component for sheet and page', () => {
    const content = source('app/(app)/items/[itemId]/ItemDetailContent.tsx');
    assert.match(content, /const hasImage = photoUrl !== null;/);
    assert.match(content, /<QuickThumb dictionary=\{dictionary\} photoUrl=\{hasImage \? photoUrl : null\} siteId=\{siteId\} \/>/);
    assert.match(content, /return photoUrl !== null \? \(\s*<div className=\{styles\.quickThumb\}>/);
    assert.match(css, /\.quickThumb \{[^}]*width: 180px;[^}]*height: 135px;/);
    assert.match(css, /\.quickTitle \{[^}]*-webkit-line-clamp: 3;/);
    assert.match(css, /\.quickGroup \{\s*display: grid;\s*grid-template-columns: 112px minmax\(0, 1fr\);[^}]*border-top: 1px solid var\(--app-divider\);/);
  });

  it('Item Detail without a picture: no media frame at all - a compact site badge instead of an empty placeholder', () => {
    const content = source('app/(app)/items/[itemId]/ItemDetailContent.tsx');
    assert.match(content, /\) : \(\s*<span aria-hidden className=\{styles\.quickSiteTile\}>/);
    assert.match(css, /\.quickSiteTile \{[^}]*width: 64px;[^}]*height: 64px;/);
    assert.doesNotMatch(content, /styles\.itemDetail\b|<ItemPhoto/);
  });

  it('the facts are typography and dividers (no boxed rows); delete is quiet; open is the one primary', () => {
    assert.match(css, /\.dangerQuiet \{\s*border-color: transparent;\s*background: transparent;/);
  });

  it('Home: the quick save is a command bar on the page (no panel around it); toolbars are not boxes', () => {
    assert.match(css, /\.addLinkPanel \{\s*padding: 0;\s*border: 0;\s*background: transparent;/);
    assert.match(css, /\.addLinkField \{\s*min-height: 60px;/);
    assert.match(css, /\.toolbar,\s*\.controlsRow,\s*\.archiveBar \{\s*padding: 0;\s*border: 0;\s*background: transparent;/);
  });

  it('responsive: the rail goes under the workspace on a narrow window', () => {
    assert.match(css, /@media \(max-width: 1180px\) \{\s*\.dashboard \{\s*grid-template-columns: minmax\(0, 1fr\);/);
  });

  it('Collections grid is unchanged in structure: cover cards, 280px columns, star on the cover', () => {
    assert.match(css, /\.collectionGrid \{\s*grid-template-columns: repeat\(auto-fill, minmax\(280px, 1fr\)\);/);
    assert.match(css, /\.coverStar \{[^}]*position: absolute;/);
  });
});
