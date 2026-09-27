import { useFocusEffect } from '@react-navigation/native';
import { useCallback, useRef } from 'react';
import { AppState } from 'react-native';
import { subscribeSocialPushEvents, type SocialPushEvent, type SocialPushEventType } from './pushEvents';

/** Returning to the app refreshes only if the screen's data is at least this old. */
export const FOREGROUND_STALE_MS = 15_000;

/**
 * Keeps a focused screen's server data fresh without polling: refreshes when the app comes back
 * to the foreground (if the last refresh is older than FOREGROUND_STALE_MS) and whenever a matching
 * social Push arrives while the app is open. Only while the screen is focused - an unfocused screen
 * refreshes on its own focus anyway (useFocusEffect). Callers keep their own request-id guard so an
 * older response never overwrites a newer one.
 */
export function useLiveRefresh(
  refresh: (event: SocialPushEvent | null) => void,
  eventTypes: readonly SocialPushEventType[],
): void {
  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;
  const lastRefreshRef = useRef(Date.now());
  const typesKey = eventTypes.join(',');

  useFocusEffect(
    useCallback(() => {
      lastRefreshRef.current = Date.now();
      const run = (event: SocialPushEvent | null) => {
        lastRefreshRef.current = Date.now();
        refreshRef.current(event);
      };
      const types = new Set(typesKey.split(','));
      const unsubscribePush = subscribeSocialPushEvents(event => {
        if (types.has(event.type)) {
          run(event);
        }
      });
      const appState = AppState.addEventListener('change', state => {
        if (state === 'active' && Date.now() - lastRefreshRef.current >= FOREGROUND_STALE_MS) {
          run(null);
        }
      });
      return () => {
        unsubscribePush();
        appState.remove();
      };
    }, [typesKey]),
  );
}
