import { useEffect, useRef, useState } from 'react';
import { isOtherDialogOpen } from '../components/dialogPresence';
import { navigationRef } from '../navigation/navigationRef';
import { useIncomingShare } from '../share/useIncomingShare';
import { getActiveTour, subscribeTour } from '../tour/tourController';

const CHECK_INTERVAL_MS = 400;

/**
 * True once the main tabs are in front and nothing else claims the person: no guided tour running, no incoming share being handled, no
 * other self-opening dialog (the app-update prompt) on screen. `extraReady` lets a caller add its own condition (the welcome waits for
 * the first-run tour to be finished or skipped). Only checked while `enabled`; once true it stays true for the caller to act on.
 */
export function useQuietHome(enabled: boolean, dialogId: string, extraReady: () => Promise<boolean> | boolean = () => true): boolean {
  const { pendingShare } = useIncomingShare();
  const pendingShareRef = useRef(pendingShare);
  pendingShareRef.current = pendingShare;
  const extraReadyRef = useRef(extraReady);
  extraReadyRef.current = extraReady;
  const [quiet, setQuiet] = useState(false);

  useEffect(() => {
    if (!enabled || quiet) {
      return undefined;
    }
    let active = true;
    let checking = false;
    const check = () => {
      if (checking || !active) {
        return;
      }
      if (pendingShareRef.current || getActiveTour() !== null || isOtherDialogOpen(dialogId) || !navigationRef.isReady()) {
        return;
      }
      // The ROOT stack's top screen: a pushed page (a Collection, the Subscription screen) is not Home.
      const rootState = navigationRef.getRootState();
      if (rootState?.routes[rootState.index]?.name !== 'MainTabs') {
        return;
      }
      checking = true;
      Promise.resolve(extraReadyRef.current())
        .then(ready => {
          checking = false;
          if (active && ready && getActiveTour() === null) {
            setQuiet(true);
          }
        })
        .catch(() => {
          checking = false;
        });
    };
    const timer = setInterval(check, CHECK_INTERVAL_MS);
    const unsubscribe = subscribeTour(check);
    check();
    return () => {
      active = false;
      clearInterval(timer);
      unsubscribe();
    };
  }, [dialogId, enabled, quiet]);

  return enabled && quiet;
}
