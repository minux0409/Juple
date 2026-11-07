import type { Collection } from '../collections/api/collectionsApi';
import { isCollectionLocked } from '../collections/collectionAccess';
import { getCollectionCapabilities } from '../collections/collectionCapabilities';
import type { FavoriteBulkState } from './collectionSelectionPolicy';

/**
 * The i18n keys the Collections list's bar buttons show for the current selection: 즐겨찾기 adds or removes by the selection's state
 * (a mix says "즐겨찾기 설정", the direction is asked on press), 잠금 is 잠금 해제 only for ONE locked Collection of the caller's, and
 * the last button is 삭제 (all deletable), 나가기 (all leavable) or the neutral 삭제/나가기 for a mix.
 */
export function collectionSelectionLabelKeys(
  single: Collection | null,
  favoriteState: FavoriteBulkState,
  deletableCount: number,
  leavableCount: number,
): { readonly favorite: string; readonly lock: string; readonly deleteOrLeave: string } {
  const favorite = favoriteState === 'allFavorite'
    ? 'collections.removeFavorite'
    : favoriteState === 'noneFavorite'
      ? 'collections.addFavorite'
      : 'selection.favoriteMixed';
  const lock = single && isCollectionLocked(single)
    && (getCollectionCapabilities(single).canChangeLock || single.isMemberLocked === true)
    ? 'collections.lockRemoveAction'
    : 'collections.lockSetTitle';
  const deleteOrLeave = deletableCount > 0 && leavableCount > 0
    ? 'selection.deleteOrLeave'
    : leavableCount > 0
      ? 'collections.leaveAction'
      : 'common.delete';
  return { favorite, lock, deleteOrLeave };
}
