import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { getAppDictionary } from '../lib/appDictionary.ts';
import { formatMessage } from '../lib/appI18n.ts';
import {
  canMergeCollection,
  clearMergeUndo,
  isMergeTarget,
  MERGE_UNDO_PATH,
  MERGE_UNDO_WINDOW_MS,
  mergePath,
  peekMergeUndo,
  rememberMergeUndo,
} from '../lib/collectionOperations.ts';

// 다른 컬렉션과 병합 - Option 1: the existing merge API (links into the target, the source soft-deleted), its undo, no new endpoint.
const source = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const repo = (path: string) => readFileSync(new URL(`../../../${path}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const ko = getAppDictionary('ko');
const view = source('app/(app)/collections/[collectionId]/CollectionDetailsView.tsx');
const merge = source('app/(app)/collections/[collectionId]/MergeCollection.tsx');
const banner = source('app/(app)/collections/[collectionId]/MergeUndoBanner.tsx');
const operations = source('lib/collectionOperations.ts');
const mergeSection = operations.slice(operations.indexOf('// ---- 다른 컬렉션과 병합'));

describe('다른 컬렉션과 병합', () => {
  it('uses the existing endpoints only - merge and its undo', () => {
    const controller = repo('backend/src/Juple.Api/Controllers/CollectionsController.cs');
    assert.ok(controller.includes('[HttpPost("{sourceCollectionId:long}/merge")]'));
    assert.ok(controller.includes('[HttpPost("merge/undo")]'));
    assert.equal(mergePath(12), '/api/v1/collections/12/merge');
    assert.equal(MERGE_UNDO_PATH, '/api/v1/collections/merge/undo');
  });

  it('is offered to the Owner of a Collection nobody else is in, with its content open - never to a member or a shared one', () => {
    assert.equal(canMergeCollection({ accessRole: 'owner', hasCollaborators: false }, true), true);
    assert.equal(canMergeCollection({ accessRole: 'owner', hasCollaborators: true }, true), false);
    assert.equal(canMergeCollection({ accessRole: 'viewer' }, true), false);
    assert.equal(canMergeCollection({ accessRole: 'contributor' }, true), false);
    assert.equal(canMergeCollection({ accessRole: 'submitter' }, true), false);
    assert.equal(canMergeCollection({ accessRole: 'owner' }, false), false, 'locked without its grant');
    assert.ok(view.includes('canMergeCollection(collection, !gate && (!isCollectionLocked(collection) || unlockTokenFor(collection.id) !== null))'));
  });

  it('targets: mine, never the source itself, nobody else in them', () => {
    assert.equal(isMergeTarget({ id: 14, accessRole: 'owner', hasCollaborators: false }, 12), true);
    assert.equal(isMergeTarget({ id: 12, accessRole: 'owner' }, 12), false);
    assert.equal(isMergeTarget({ id: 11, accessRole: 'owner', hasCollaborators: true }, 12), false);
    assert.equal(isMergeTarget({ id: 13, accessRole: 'viewer' }, 12), false);
    assert.ok(merge.includes('eligible={candidate => isMergeTarget(candidate, collection.id)}'));
    assert.ok(merge.includes('excluded={[collection.id]}'));
  });

  it('asks first, in red, naming source, target and the link count, and says the source is deleted - never "영구 삭제"', () => {
    assert.match(merge, /<ConfirmDialog[\s\S]*confirmLabel=\{dictionary\.mergeAction\}\s*destructive/);
    assert.ok(merge.includes('formatMessage(dictionary.mergeConfirmBody, { source: collection.name, target: target.collection.name, count: collection.itemCount })'));
    const body = formatMessage(ko.mergeConfirmBody, { source: 'A', target: 'B', count: 12 });
    assert.equal(body, '"A"의 링크 12개를 "B"에 합칩니다. 이미 "B"에 있는 링크는 중복되지 않아요. 병합이 완료되면 "A" 컬렉션은 삭제되며, 병합 직후에는 되돌릴 수 있어요.');
    assert.doesNotMatch(body + ko.mergeConfirmTitle, /영구/);
    assert.equal(ko.mergeConfirmTitle, '컬렉션을 병합할까요?');
    assert.equal(ko.mergeAction, '병합');
  });

  it('has no duplicate logic of its own: the server adds only what the target lacks (per link); the Web sends just the target', () => {
    assert.match(merge, /body: \{ targetCollectionId: target\.collection\.id \},\s*headers: grantHeaders\(unlockTokenFor\(collection\.id\), target\.unlockToken\)/);
    assert.doesNotMatch(merge + mergeSection, /\.url\b|dedupe|new Set\(/);
    assert.ok(repo('backend/src/Juple.Infrastructure/Collections/CollectionStore.cs').includes('if (targetItemIds.Add(membership.ItemId))'));
  });

  it('opens the target with 되돌리기 on success; stays on the untouched source on failure; never deletes anything itself', () => {
    assert.ok(merge.includes('rememberMergeUndo({ undoOperationId: result.undoOperationId, sourceCollectionId: collection.id, targetCollectionId: target.collection.id, sourceName: collection.name });'));
    assert.ok(merge.includes('router.replace(collectionHref(target.collection.id));'));
    assert.ok(merge.includes('onFailed(contentGateOf(caught) ? dictionary.lockRequiredForAction : dictionary.mergeError);'));
    assert.doesNotMatch(merge + banner, /method: 'DELETE'/);
  });

  it('hands the undo to its target only, right after the merge, once', () => {
    rememberMergeUndo({ undoOperationId: 'op', sourceCollectionId: 12, targetCollectionId: 14, sourceName: 'A' }, 1000);
    assert.equal(peekMergeUndo(11, 1000), null);
    assert.deepEqual(peekMergeUndo(14, 2000), { undoOperationId: 'op', sourceCollectionId: 12, targetCollectionId: 14, sourceName: 'A' });
    assert.equal(peekMergeUndo(14, 1000 + 16_000), null, 'a later visit never offers it');
    clearMergeUndo('op');
    assert.equal(peekMergeUndo(14, 2000), null);
  });

  it('offers 되돌리기 for mobile\'s undo time; a successful undo reads the page again; a refused one is said and stays', () => {
    assert.equal(MERGE_UNDO_WINDOW_MS, 5000);
    assert.match(repo('apps/mobile/src/components/UndoToast.tsx'), /UNDO_TOAST_DURATION_MS = 5000/);
    assert.ok(banner.includes("api<void>({ method: 'POST', path: MERGE_UNDO_PATH, body: { undoOperationId: undo.undoOperationId } })"));
    assert.match(banner, /setTimeout\(\(\) => \{\s*clearMergeUndo\(undo\.undoOperationId\);\s*onDone\(\);\s*\}, MERGE_UNDO_WINDOW_MS\)/);
    assert.match(banner, /if \(phase !== 'offer'\) \{\s*return undefined;/, 'a failure is not timed away');
    assert.ok(banner.includes("{phase === 'failed' ? dictionary.undoMergeError : dictionary.mergeSuccess}"));
    assert.match(view, /onUndone=\{\(\) => \{\s*setReloadToken\(token => token \+ 1\);\s*setContentToken\(token => token \+ 1\);/);
    assert.equal(ko.undoAction, '되돌리기');
    assert.equal(ko.mergeSuccess, '컬렉션을 병합했습니다.');
  });

  it('keeps three different things apart: 다른 컬렉션에 복제 / 내 컬렉션으로 복제 / 다른 컬렉션과 병합', () => {
    assert.ok(operations.includes('다른 컬렉션에 복제 (replicatePath): my link stays here AND joins other Collections'));
    assert.ok(operations.includes("내 컬렉션으로 복제 (cloneCollection): someone else's Collection copied into a NEW one of mine"));
    assert.ok(operations.includes('다른 컬렉션과 병합 (mergePath): every link of MY Collection joins another of mine, then this Collection is DELETED'));
    assert.equal(ko.addToOther, '다른 컬렉션에 복제');
    assert.equal(ko.cloneToMine, '내 컬렉션으로 복제');
    assert.equal(ko.mergeWithOther, '다른 컬렉션과 병합');
    // A member gets 내 컬렉션으로 복제, the Owner 병합 - never both in one menu; clone / copy never call merge.
    assert.match(view, /isSharedWithMe\(collection\) && !gate\s*\? \[\{ key: 'clone'[\s\S]*?: canMergeCollection/);
    assert.doesNotMatch(operations.slice(0, operations.indexOf('// ---- 다른 컬렉션과 병합')), /mergePath\(/);
  });
});
