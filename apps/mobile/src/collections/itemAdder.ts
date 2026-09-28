import type { TFunction } from 'i18next';
import { personLabel } from './api/collaborationApi';
import type { Collection, CollectionItemAdder, CollectionItemEntry } from './api/collectionsApi';
import { isCollaborative } from './collectionAccess';

/**
 * The short "who added this link" text of a Collection's link: 나 / 피카츄 · 소유자 / 파이리 /
 * 공개 링크로 추가됨. Null when the server could not say (the label is then simply not shown).
 */
export function formatItemAdder(adder: CollectionItemAdder | null | undefined, t: TFunction): string | null {
  if (!adder) {
    return null;
  }
  switch (adder.kind) {
    case 'me':
      return t('collections.addedByMe');
    case 'owner':
      return adder.jupleId ? t('collections.addedByOwner', { name: personLabel({ jupleId: adder.jupleId, displayName: adder.displayName }) }) : null;
    case 'member':
      return adder.jupleId ? personLabel({ jupleId: adder.jupleId, displayName: adder.displayName }) : null;
    case 'publicLink':
      return t('collections.addedViaPublicLink');
    default:
      return null;
  }
}

/**
 * Adders only mean something where more than one person can add: a Collection with participants,
 * or one where a link came in through its 모든 사용자 link. A private Collection (every link "나")
 * stays as quiet as before. Decided once for the whole list, so every row/tile of it has the same
 * height.
 */
export function shouldShowItemAdders(
  collection: Pick<Collection, 'accessRole' | 'hasCollaborators' | 'isPublicShareActive'> | null,
  items: readonly Pick<CollectionItemEntry, 'addedBy'>[],
): boolean {
  if (collection && isCollaborative(collection)) {
    return true;
  }
  return items.some(item => item.addedBy != null && item.addedBy.kind !== 'me');
}
