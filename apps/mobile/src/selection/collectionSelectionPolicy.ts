import type { Collection } from '../collections/api/collectionsApi';
import { isCollectionLocked } from '../collections/collectionAccess';
import { getCollectionCapabilities } from '../collections/collectionCapabilities';

/** The bulk actions of the Collections list's bottom bar. */
export type CollectionBarActionKey = 'favorite' | 'lock' | 'shortcut' | 'deleteOrLeave' | 'more';

export type FavoriteBulkState = 'allFavorite' | 'noneFavorite' | 'mixed';

export function favoriteStateOf(selected: readonly Pick<Collection, 'isFavorite'>[]): FavoriteBulkState {
  const favorites = selected.filter(collection => collection.isFavorite).length;
  if (favorites === 0) {
    return 'noneFavorite';
  }
  return favorites === selected.length ? 'allFavorite' : 'mixed';
}

/** Collections I may delete (I own them) and those I can only leave (another person's) - never one action for both. */
export function partitionDeleteLeave(selected: readonly Collection[]): { readonly deletable: readonly Collection[]; readonly leavable: readonly Collection[] } {
  const deletable: Collection[] = [];
  const leavable: Collection[] = [];
  selected.forEach(collection => {
    const capabilities = getCollectionCapabilities(collection);
    if (capabilities.canDelete) {
      deletable.push(collection);
    } else if (capabilities.canLeave) {
      leavable.push(collection);
    }
  });
  return { deletable, leavable };
}

/**
 * Collections 잠금 can be set on in bulk: not locked yet, and the caller has a lock to set (the Owner's Collection lock, or a member's
 * personal lock). Taking a lock OFF is never done in bulk - it needs the lock password and stays the single Collection's own flow.
 */
export function lockableCollections(selected: readonly Collection[]): readonly Collection[] {
  return selected.filter(collection => {
    const capabilities = getCollectionCapabilities(collection);
    return !isCollectionLocked(collection) && (capabilities.canChangeLock || capabilities.canChangeMemberLock);
  });
}

export interface CollectionSelectionActions {
  readonly bar: readonly CollectionBarActionKey[];
  readonly favoriteState: FavoriteBulkState;
}

/**
 * 즐겨찾기, 잠금, 바로가기 (one Collection only), 삭제/나가기, then 더보기 (one Collection's own management only). `shortcutSupported`: the launcher can pin
 * a Home icon (Android); where it cannot (iOS has no such API) the button is not drawn at all. 잠금 shows for a single Collection (set or
 * remove - its own flow) and for several only while at least one of them can still be locked.
 */
export function getCollectionSelectionActions(
  selected: readonly Collection[],
  options: { readonly shortcutSupported: boolean },
): CollectionSelectionActions {
  const bar: CollectionBarActionKey[] = [];
  if (selected.length > 0) {
    bar.push('favorite');
    const single = selected.length === 1;
    const capabilities = single ? getCollectionCapabilities(selected[0]) : null;
    const canLock = single ? capabilities?.canChangeLock === true || capabilities?.canChangeMemberLock === true : lockableCollections(selected).length > 0;
    if (canLock) {
      bar.push('lock');
    }
    // A Home icon is created per request by the system dialog, so it is offered for exactly one Collection.
    if (options.shortcutSupported && single) {
      bar.push('shortcut');
    }
    const { deletable, leavable } = partitionDeleteLeave(selected);
    if (deletable.length + leavable.length > 0) {
      bar.push('deleteOrLeave');
    }
    // 수정, 공유, 알림 and removal from the share targets belong to exactly one Collection.
    if (single) {
      bar.push('more');
    }
  }
  return { bar, favoriteState: favoriteStateOf(selected) };
}
