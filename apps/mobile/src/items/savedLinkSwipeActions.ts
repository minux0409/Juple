/**
 * What a saved-link row's swipe reveals - the ONE place Home and the Archive decide it, used both to build the row
 * (SwipeableItemRow's onShare / onDelete) and to decide whether the swipe hint has anything to teach.
 * A link held by a locked Collection cannot be shared from the row; deleting is always offered.
 */
export interface SavedLinkSwipeActions {
  readonly share: boolean;
  readonly delete: boolean;
}

export function getSavedLinkSwipeActions(item: { readonly isCollectionLocked?: boolean | null }): SavedLinkSwipeActions {
  return { share: !item.isCollectionLocked, delete: true };
}

export function hasSavedLinkSwipeActions(item: { readonly isCollectionLocked?: boolean | null }): boolean {
  const actions = getSavedLinkSwipeActions(item);
  return actions.share || actions.delete;
}
