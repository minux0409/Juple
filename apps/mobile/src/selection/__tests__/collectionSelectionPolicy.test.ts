import type { Collection } from '../../collections/api/collectionsApi';
import {
  favoriteStateOf,
  getCollectionSelectionActions,
  lockableCollections,
  partitionDeleteLeave,
} from '../collectionSelectionPolicy';
import { collectionSelectionLabelKeys } from '../collectionSelectionLabels';

function collection(id: number, overrides: Partial<Collection> = {}): Collection {
  return {
    id,
    name: `Collection ${id}`,
    isFavorite: false,
    itemCount: 0,
    accessRole: 'owner',
    ...overrides,
  } as Collection;
}

const owned = (id: number, overrides: Partial<Collection> = {}) => collection(id, { accessRole: 'owner', ...overrides });
const shared = (id: number, overrides: Partial<Collection> = {}) => collection(id, { accessRole: 'contributor', ...overrides });

describe('Collections list selection', () => {
  it('derives the favorite direction from the selection', () => {
    expect(favoriteStateOf([owned(1, { isFavorite: true }), owned(2, { isFavorite: true })])).toBe('allFavorite');
    expect(favoriteStateOf([owned(1), owned(2)])).toBe('noneFavorite');
    expect(favoriteStateOf([owned(1, { isFavorite: true }), owned(2)])).toBe('mixed');
  });

  it("never merges delete and leave: my Collections are deleted, someone else's are left", () => {
    const { deletable, leavable } = partitionDeleteLeave([owned(1), shared(2), owned(3), shared(4)]);
    expect(deletable.map(entry => entry.id)).toEqual([1, 3]);
    expect(leavable.map(entry => entry.id)).toEqual([2, 4]);
  });

  it('locks in bulk only what is not locked yet; taking a lock off is never a bulk action', () => {
    const lockable = lockableCollections([owned(1), owned(2, { isLocked: true }), shared(3)]);
    expect(lockable.map(entry => entry.id)).toEqual([1, 3]);
  });

  it('offers 즐겨찾기, 잠금 and 삭제/나가기 for several (never 바로가기), and 바로가기 + 더보기 only for one', () => {
    const several = getCollectionSelectionActions([owned(1), shared(2)], { shortcutSupported: true }).bar;
    expect(several).toEqual(['favorite', 'lock', 'deleteOrLeave']);
    const one = getCollectionSelectionActions([owned(1)], { shortcutSupported: true }).bar;
    expect(one).toEqual(['favorite', 'lock', 'shortcut', 'deleteOrLeave', 'more']);
  });

  it('바로가기 comes back when the selection is exactly one again', () => {
    const list = [owned(1), owned(2)];
    expect(getCollectionSelectionActions(list, { shortcutSupported: true }).bar).not.toContain('shortcut');
    expect(getCollectionSelectionActions(list.slice(0, 1), { shortcutSupported: true }).bar).toContain('shortcut');
  });

  it('does not draw 바로가기 where the launcher cannot pin one (iOS has no such API)', () => {
    expect(getCollectionSelectionActions([owned(1)], { shortcutSupported: false }).bar).not.toContain('shortcut');
  });

  it('hides 잠금 for several Collections that are all locked already', () => {
    const bar = getCollectionSelectionActions([owned(1, { isLocked: true }), owned(2, { isLocked: true })], { shortcutSupported: false }).bar;
    expect(bar).not.toContain('lock');
  });

  it('labels the last button by what it will do', () => {
    expect(collectionSelectionLabelKeys(null, 'noneFavorite', 2, 0).deleteOrLeave).toBe('common.delete');
    expect(collectionSelectionLabelKeys(null, 'noneFavorite', 0, 2).deleteOrLeave).toBe('collections.leaveAction');
    expect(collectionSelectionLabelKeys(null, 'noneFavorite', 1, 1).deleteOrLeave).toBe('selection.deleteOrLeave');
  });

  it('labels 즐겨찾기 by the selection: add, remove, or a neutral word when mixed', () => {
    expect(collectionSelectionLabelKeys(null, 'noneFavorite', 1, 0).favorite).toBe('collections.addFavorite');
    expect(collectionSelectionLabelKeys(null, 'allFavorite', 1, 0).favorite).toBe('collections.removeFavorite');
    expect(collectionSelectionLabelKeys(null, 'mixed', 1, 0).favorite).toBe('selection.favoriteMixed');
  });
});
