/**
 * Test helper for navigation/collectionNavigation: a Collection now opens inside the 컬렉션 tab, so screens outside it dispatch one
 * root action (back to MainTabs -> Collections -> CollectionDetails) instead of navigate('CollectionDetails', params). This reads the
 * CollectionDetails params back out of whatever a `dispatch` mock received, so a test still asserts "which Collection, with what".
 */
type DispatchedAction = { readonly type?: string; readonly payload?: { readonly name?: string; readonly params?: unknown } };
type CollectionTabParams = { readonly screen?: string; readonly params?: { readonly screen?: string; readonly params?: unknown } };

function collectionParamsOf(action: DispatchedAction): unknown {
  const payload = action?.payload;
  if (payload?.name !== 'MainTabs') {
    return undefined;
  }
  const tab = payload.params as CollectionTabParams | undefined;
  return tab?.screen === 'Collections' && tab.params?.screen === 'CollectionDetails' ? tab.params.params : undefined;
}

/** The CollectionDetails params of every "open this Collection" action the mock received, oldest first. */
export function openedCollections(dispatch: unknown): unknown[] {
  const calls = (dispatch as jest.Mock).mock.calls as [DispatchedAction][];
  return calls.map(([action]) => collectionParamsOf(action)).filter(params => params !== undefined);
}

/** The type of the action that opened the last Collection: 'NAVIGATE' (back to the MainTabs underneath) or 'REPLACE' (cold start). */
export function lastOpenCollectionActionType(dispatch: unknown): string | undefined {
  const calls = (dispatch as jest.Mock).mock.calls as [DispatchedAction][];
  return calls.map(([action]) => action).filter(action => collectionParamsOf(action) !== undefined).at(-1)?.type;
}
