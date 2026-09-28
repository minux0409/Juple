import { useFocusEffect } from '@react-navigation/native';
import { useCallback, useRef } from 'react';
import { AppState } from 'react-native';
import { subscribeSocialPushEvents, type SocialPushEvent, type SocialPushEventType } from './pushEvents';

/** Returning to the app refreshes only if the screen's data is at least this old. */
export const FOREGROUND_STALE_MS = 15_000;

/**
 * A narrow, bounded poll for one screen - never a global one. `poll` runs every `intervalMs` only
 * while ALL of these hold: the screen is focused, `enabled` (e.g. "I have a sent request someone
 * still has to answer"), the app is in the foreground, and the previous poll has finished; and at
 * most for `maxDurationMs` after the screen gained focus or `enabled` last turned on - after that
 * the screen falls back to Push / focus / app-resume refresh (useLiveRefresh) alone, so an
 * unanswered request left on screen does not poll forever. Leaving the screen, disabling or
 * unmounting clears the timer.
 */
export function useFocusedPolling(
  poll: () => Promise<unknown> | void,
  { intervalMs, maxDurationMs, enabled }: { readonly intervalMs: number; readonly maxDurationMs: number; readonly enabled: boolean },
): void {
  const pollRef = useRef(poll);
  pollRef.current = poll;

  useFocusEffect(
    useCallback(() => {
      if (!enabled) {
        return undefined;
      }
      const startedAt = Date.now();
      let inFlight = false;
      const timer = setInterval(() => {
        if (Date.now() - startedAt > maxDurationMs) {
          clearInterval(timer);
          return;
        }
        // Paused while backgrounded/inactive (an iOS app can still report 'unknown' before its
        // first state change - that is not treated as background).
        const appState = AppState.currentState;
        if (inFlight || appState === 'background' || appState === 'inactive') {
          return;
        }
        inFlight = true;
        Promise.resolve()
          .then(() => pollRef.current())
          .catch(() => undefined)
          .finally(() => {
            inFlight = false;
          });
      }, intervalMs);
      return () => clearInterval(timer);
    }, [enabled, intervalMs, maxDurationMs]),
  );
}

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
