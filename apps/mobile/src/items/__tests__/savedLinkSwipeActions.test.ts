import { getSavedLinkSwipeActions, hasSavedLinkSwipeActions } from '../savedLinkSwipeActions';

describe('saved-link swipe actions', () => {
  it('a normal link can be shared and deleted from its row', () => {
    expect(getSavedLinkSwipeActions({ isCollectionLocked: false })).toEqual({ share: true, delete: true });
    expect(getSavedLinkSwipeActions({})).toEqual({ share: true, delete: true });
  });

  it('a link held by a locked Collection cannot be shared from the row, but can still be deleted', () => {
    expect(getSavedLinkSwipeActions({ isCollectionLocked: true })).toEqual({ share: false, delete: true });
  });

  it('a row with at least one action makes the swipe hint worthwhile', () => {
    expect(hasSavedLinkSwipeActions({ isCollectionLocked: true })).toBe(true);
    expect(hasSavedLinkSwipeActions({ isCollectionLocked: false })).toBe(true);
  });
});
