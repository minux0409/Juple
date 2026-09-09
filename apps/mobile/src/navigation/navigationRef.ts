import { createNavigationContainerRef } from '@react-navigation/native';
import type { RootStackParamList } from './RootStack';

/**
 * Lets code outside the React tree navigate imperatively, since it has no `navigation` prop of its
 * own (no active feature currently does this - kept wired into NavigationContainer in App.tsx for
 * whichever future feature needs it, e.g. a Push notification tap handler). `navigationRef.isReady()`
 * only means NavigationContainer has mounted - it says nothing about which screens RootStack
 * currently renders (that also depends on auth/bootstrap state), so a future caller must not treat
 * it as "safe to navigate anywhere" on its own.
 */
export const navigationRef = createNavigationContainerRef<RootStackParamList>();
