import type { TFunction } from 'i18next';
import { personLabel } from './api/collaborationApi';
import type { Collection, CollectionItemAdder, CollectionItemEntry } from './api/collectionsApi';
import { isCollaborative } from './collectionAccess';

/** How a link's adder is drawn on a card: a person's avatar (with a crown for the Owner), or the anonymous public-link text. */
export type ItemAdderDisplay =
  | {
      readonly kind: 'person';
      /** Null for an older response without the caller's own identity: a plain person glyph then. */
      readonly jupleId: string | null;
      readonly displayName: string | null;
      readonly imageUrl: string | null;
      readonly imageVersion: string | null;
      readonly isCollectionOwner: boolean;
      readonly accessibilityLabel: string;
    }
  | { readonly kind: 'publicLink'; readonly label: string; readonly accessibilityLabel: string };

/**
 * A link's adder for a Collection card: who it was by avatar only - no nickname or 소유자 text on the
 * card - while assistive technology still hears it in words ("컬렉션 소유자 피카츄님이 추가한 링크").
 * Someone who added through the public link stays anonymous. Null when the server could not say.
 */
export function describeItemAdder(adder: CollectionItemAdder | null | undefined, t: TFunction): ItemAdderDisplay | null {
  if (!adder) {
    return null;
  }
  if (adder.kind === 'publicLink') {
    const label = t('collections.addedViaPublicLink');
    return { kind: 'publicLink', label, accessibilityLabel: t('collections.addedByA11y', { name: label }) };
  }
  if (adder.kind !== 'me' && !adder.jupleId) {
    return null;
  }
  const isCollectionOwner = adder.isCollectionOwner === true || adder.kind === 'owner';
  const name = adder.jupleId ? personLabel({ jupleId: adder.jupleId, displayName: adder.displayName }) : '';
  const accessibilityLabel = adder.kind === 'me'
    ? t('collections.addedByMeA11y')
    : isCollectionOwner
      ? t('collections.addedByOwnerA11y', { name })
      : t('collections.addedByMemberA11y', { name });
  return {
    kind: 'person',
    jupleId: adder.jupleId ?? null,
    displayName: adder.displayName ?? null,
    imageUrl: adder.profileImageUrl ?? null,
    imageVersion: adder.profileImageVersion ?? null,
    isCollectionOwner,
    accessibilityLabel,
  };
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
