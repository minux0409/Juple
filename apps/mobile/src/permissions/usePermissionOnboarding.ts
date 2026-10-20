import { useEffect, useState } from 'react';
import { AppState } from 'react-native';
import { navigationRef } from '../navigation/navigationRef';
import { useAuthenticatedApi } from '../api/useAuthenticatedApi';
import { ensurePushPermissionOnce } from '../push/pushPermissionFlow';
import { pushRegistrationEpoch } from '../push/pushMutationQueue';

/** Keep startup mounted until the OS decision finishes; there is no permission route. */
export function usePermissionOnboarding(enabled: boolean) {
  const [status, setStatus] = useState<'loading' | 'done'>('loading');
  const request = useAuthenticatedApi();
  useEffect(() => {
    setStatus('loading');
    if (!enabled) return;
    let current = true;
    let running = false;
    let finished = false;
    const epoch = pushRegistrationEpoch();
    const isCurrent = () => current && epoch === pushRegistrationEpoch();
    const run = async () => {
      if (!isCurrent() || running || finished || !navigationRef.isReady() || AppState.currentState !== 'active') return;
      running = true;
      try {
        await ensurePushPermissionOnce(request, isCurrent);
      } finally {
        running = false;
        if (isCurrent() && AppState.currentState === 'active') {
          finished = true;
          clearInterval(timer);
          setStatus('done');
        }
      }
    };
    const start = () => { run().catch(() => undefined); };
    const foreground = AppState.addEventListener('change', state => {
      if (state === 'active') start();
    });
    // NavigationContainer readiness can follow this effect.
    const timer = setInterval(start, 250);
    start();
    return () => { current = false; clearInterval(timer); foreground.remove(); };
  }, [enabled, request]);
  return { status };
}
