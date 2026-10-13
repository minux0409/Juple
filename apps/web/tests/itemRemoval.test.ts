import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { affectsList, removesFromList, type ItemChange, type ItemListScope } from '../lib/itemChanges.ts';
import { removeItemFromSections } from '../lib/sectionRemoval.ts';

const source = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

const personal: ItemListScope = { kind: 'personal' };
const inCollection = (collectionId: number): ItemListScope => ({ kind: 'collection', collectionId });
const deleted: ItemChange = { kind: 'deleted', itemId: 7 };
const removed: ItemChange = { kind: 'removedFromCollection', itemId: 7, collectionId: 3 };
const updated: ItemChange = { kind: 'updated', itemId: 7 };

describe('item change semantics', () => {
  it('a deletion leaves every list; a membership removal only its own Collection; an edit removes nothing', () => {
    for (const scope of [personal, inCollection(3), inCollection(9)]) {
      assert.equal(removesFromList(deleted, scope), true);
      assert.equal(removesFromList(updated, scope), false);
    }
    assert.equal(removesFromList(removed, inCollection(3)), true);
    assert.equal(removesFromList(removed, inCollection(9)), false, 'another Collection keeps it');
    assert.equal(removesFromList(removed, personal), false, '보관함 / Home keep the link');
  });

  it('a membership removal is not even a refresh for 보관함 / Home or another Collection', () => {
    assert.equal(affectsList(removed, personal), false);
    assert.equal(affectsList(removed, inCollection(9)), false);
    assert.equal(affectsList(removed, inCollection(3)), true);
    assert.equal(affectsList(updated, personal), true);
    assert.equal(affectsList(deleted, inCollection(9)), true);
  });
});

describe('removeItemFromSections', () => {
  type Page = { readonly items: readonly { readonly id: number }[] };
  const sections = [
    { key: 'today', count: 2 },
    { key: 'yesterday', count: 1 },
  ];
  const pages = new Map<string, Page>([
    ['today', { items: [{ id: 1 }, { id: 2 }] }],
    ['yesterday', { items: [{ id: 3 }] }],
  ]);
  const itemsOf = (page: Page) => page.items;
  const without = (page: Page, id: number): Page => ({ items: page.items.filter(item => item.id !== id) });

  it('the card leaves its page and the section count goes down by one', () => {
    const result = removeItemFromSections(sections, pages, 1, itemsOf, without);
    assert.equal(result.removed, true);
    assert.deepEqual(result.pages.get('today'), { items: [{ id: 2 }] });
    assert.deepEqual(result.sections, [
      { key: 'today', count: 1 },
      { key: 'yesterday', count: 1 },
    ]);
    assert.deepEqual(pages.get('today'), { items: [{ id: 1 }, { id: 2 }] }, 'the input is not mutated');
  });

  it('the last link of a section removes the section itself', () => {
    const result = removeItemFromSections(sections, pages, 3, itemsOf, without);
    assert.deepEqual(
      result.sections.map(section => section.key),
      ['today'],
    );
    assert.equal(result.pages.has('yesterday'), false);
  });

  it('a link that is not loaded changes nothing (the caller reads again)', () => {
    const result = removeItemFromSections(sections, pages, 99, itemsOf, without);
    assert.equal(result.removed, false);
    assert.equal(result.sections, sections);
  });

  it('a section with more unloaded links keeps count - 1', () => {
    const result = removeItemFromSections([{ key: 'today', count: 40 }], new Map([['today', { items: [{ id: 1 }] }]]), 1, itemsOf, without);
    assert.deepEqual(result.sections, [{ key: 'today', count: 39 }]);
  });
});

describe('every list hears the signal', () => {
  it('DateSections (보관함 시간순 / Collection 시간순) subscribes and removes locally', () => {
    const sections = source('app/(app)/DateSections.tsx');
    assert.match(sections, /useItemsChanged\(change =>/);
    assert.match(sections, /removeItemFromSections/);
  });

  it('보관함 passes the personal scope, a Collection its own; Home / flat archive / by-name remove locally', () => {
    assert.match(source('app/(app)/archive/ArchiveView.tsx'), /scope=\{\{ kind: 'personal' \}\}/);
    const details = source('app/(app)/collections/[collectionId]/CollectionDetailsView.tsx');
    assert.match(details, /scope=\{\{ kind: 'collection', collectionId: collection\.id \}\}/);
    assert.match(details, /entry\.itemId !== change\.itemId/);
    assert.match(source('app/(app)/HomeView.tsx'), /link\.id !== change\.itemId/);
    assert.match(source('app/(app)/archive/ArchiveView.tsx'), /link\.id !== change\.itemId/);
  });

  it('the sheet closes itself on a confirmed 404 only; 401 / 403 / network stay `failed`', () => {
    assert.match(source('app/(app)/items/[itemId]/QuickDetailSheet.tsx'), /onGone=\{\(\) => router\.back\(\)\}/);
    assert.match(source('app/(app)/items/[itemId]/ItemDetailContent.tsx'), /const gone = state\.kind === 'notFound' && itemId !== null;/);
    assert.match(source('app/(app)/items/[itemId]/useItemRecord.ts'), /isNotFound\(error\) \? \{ kind: 'notFound' \} : \{ kind: 'failed' \}/);
    assert.match(source('lib/collectionDetails.ts'), /error\.status === 404/);
  });

  it('a failed delete notifies nothing (the card stays)', () => {
    const content = source('app/(app)/items/[itemId]/ItemDetailContent.tsx');
    const start = content.indexOf('caught => {');
    assert.ok(start > 0);
    assert.doesNotMatch(content.slice(start, start + 400), /notifyItemsChanged/);
  });
});

describe('other writers speak the right fact', () => {
  const content = source('app/(app)/items/[itemId]/ItemDetailContent.tsx');

  it('a move to another Collection only removes THIS membership; a replicate is an update; delete vs 컬렉션에서 제거 are different facts', () => {
    assert.match(content, /notifyItemsChanged\(\{ kind: 'removedFromCollection', itemId, collectionId: fromCollectionId as number \}\);\s*onLeave\(\);/);
    assert.match(content, /reloadCollections\(\);\s*notifyItemsChanged\(\{ kind: 'updated', itemId \}\);/);
    assert.match(content, /fromCollectionId !== null \? \{ kind: 'removedFromCollection', itemId, collectionId: fromCollectionId \} : \{ kind: 'deleted', itemId \}/);
    assert.doesNotMatch(content, /notifyItemsChanged\(\);/, 'no anonymous signal is left');
  });

  it('a merge and its undo refresh the lists (many links changed), nothing is removed locally', () => {
    assert.match(source('app/(app)/collections/[collectionId]/MergeCollection.tsx'), /notifyItemsChanged\(\{ kind: 'refresh' \}\)/);
    assert.match(source('app/(app)/collections/[collectionId]/MergeUndoBanner.tsx'), /notifyItemsChanged\(\{ kind: 'refresh' \}\)/);
    for (const scope of [personal, inCollection(3)]) {
      assert.equal(removesFromList({ kind: 'refresh' }, scope), false);
      assert.equal(affectsList({ kind: 'refresh' }, scope), true);
    }
  });

  it('the flat 보관함 (이름순 / 검색) removes from its loaded items whatever the view mode, keeping later pages', () => {
    const archive = source('app/(app)/archive/ArchiveView.tsx');
    const start = archive.indexOf('useItemsChanged(change =>');
    assert.ok(start > 0);
    const handler = archive.slice(start, start + 700);
    assert.match(handler, /current\.items\.filter\(link => link\.id !== change\.itemId\)/);
    assert.doesNotMatch(handler, /viewMode|window\.location|router\.refresh/);
  });

  it('no hard reload anywhere in the removal path', () => {
    for (const file of ['DateSections.tsx', 'HomeView.tsx', 'archive/ArchiveView.tsx', 'items/[itemId]/ItemDetailContent.tsx']) {
      assert.doesNotMatch(source(`app/(app)/${file}`), /router\.refresh|location\.reload/, file);
    }
  });
});
