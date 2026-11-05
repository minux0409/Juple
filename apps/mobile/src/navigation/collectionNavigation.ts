import { CommonActions, StackActions, type NavigationState, type NavigatorScreenParams } from '@react-navigation/native';
import type { CollectionDetailsParams } from './CollectionsStack';
import type { MainTabParamList } from './MainTabs';

/** The MainTabs params that open one Collection in the 컬렉션 tab, with the Collections list under it (back returns to the list). */
export function collectionDetailsTabParams(params: CollectionDetailsParams): NavigatorScreenParams<MainTabParamList> {
  return { screen: 'Collections', params: { screen: 'CollectionDetails', params, initial: false } };
}

/**
 * Opens a Collection from anywhere OUTSIDE the 컬렉션 tab (a root screen such as 알림 / 친구, a Push, a Home-screen shortcut, a
 * shared link): back to the MainTabs already at the bottom of the root stack - never a second one (in React Navigation 7 a plain
 * `navigate` to a route that is not the current one pushes a new copy) - then the Collection inside the 컬렉션 tab. Dispatch it on
 * the root navigator (navigationRef, or a root stack screen's navigation).
 */
export function openCollectionDetailsAction(params: CollectionDetailsParams) {
  return CommonActions.navigate({ name: 'MainTabs', params: collectionDetailsTabParams(params), pop: true });
}

/**
 * Back to the Collections list in the 컬렉션 tab, reloaded (refreshToken) - after a Collection was deleted or left, or a deletion
 * undone. Pops whatever is on top of the MainTabs already there (never a new one, which would lose the other tabs' state), selects
 * the 컬렉션 tab and pops its stack to the list. Dispatched from anywhere: it bubbles up to the root stack.
 */
export function showCollectionsListAction(refreshToken: number) {
  return CommonActions.navigate({
    name: 'MainTabs',
    params: { screen: 'Collections', params: { screen: 'CollectionsHome', params: { refreshToken }, pop: true } },
    pop: true,
  });
}

/**
 * The same for a root screen that hands over to the Collection instead of staying under it (a shared link whose viewer turned out
 * to be a member): with MainTabs below, back to it (the link screen goes); a cold start straight into the link has no MainTabs yet,
 * so the link screen is replaced by it.
 */
export function replaceWithCollectionDetailsAction(rootState: Pick<NavigationState, 'routes'>, params: CollectionDetailsParams) {
  return rootState.routes.some(route => route.name === 'MainTabs')
    ? openCollectionDetailsAction(params)
    : StackActions.replace('MainTabs', collectionDetailsTabParams(params));
}
