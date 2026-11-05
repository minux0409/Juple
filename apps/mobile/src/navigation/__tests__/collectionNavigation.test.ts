import {
  collectionDetailsTabParams,
  openCollectionDetailsAction,
  replaceWithCollectionDetailsAction,
  showCollectionsListAction,
} from '../collectionNavigation';

describe('collection navigation (a Collection lives in the 컬렉션 tab)', () => {
  it('opens a Collection in the 컬렉션 tab with the Collections list under it', () => {
    expect(collectionDetailsTabParams({ collectionId: 3, openApprovals: true })).toEqual({
      screen: 'Collections',
      params: { screen: 'CollectionDetails', params: { collectionId: 3, openApprovals: true }, initial: false },
    });
  });

  it('from a root screen: back to the MainTabs underneath (pop) - never a second MainTabs', () => {
    expect(openCollectionDetailsAction({ collectionId: 3 })).toEqual({
      type: 'NAVIGATE',
      payload: { name: 'MainTabs', params: collectionDetailsTabParams({ collectionId: 3 }), pop: true },
    });
  });

  it('a hand-over (shared link -> member): back to MainTabs when it is there, otherwise the link screen is replaced by it', () => {
    expect(replaceWithCollectionDetailsAction({ routes: [{ key: 'a', name: 'MainTabs' }, { key: 'b', name: 'SharedCollection' }] } as never, { collectionId: 5 }))
      .toEqual(openCollectionDetailsAction({ collectionId: 5 }));
    expect(replaceWithCollectionDetailsAction({ routes: [{ key: 'b', name: 'SharedCollection' }] } as never, { collectionId: 5 }))
      .toEqual({ type: 'REPLACE', payload: { name: 'MainTabs', params: collectionDetailsTabParams({ collectionId: 5 }) } });
  });

  it('back to the Collections list, reloaded: pops the root to MainTabs and the 컬렉션 stack to the list', () => {
    expect(showCollectionsListAction(123)).toEqual({
      type: 'NAVIGATE',
      payload: {
        name: 'MainTabs',
        params: { screen: 'Collections', params: { screen: 'CollectionsHome', params: { refreshToken: 123 }, pop: true } },
        pop: true,
      },
    });
  });
});
