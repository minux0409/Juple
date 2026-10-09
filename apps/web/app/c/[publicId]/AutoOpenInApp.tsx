'use client';

import { useEffect } from 'react';

/**
 * One attempt, on load, to hand this share over to the installed Android app (Chrome's intent:// link to the canonical URL).
 * Needed because some in-app browsers (KakaoTalk, Instagram, other WebViews) show the https link themselves instead of passing it
 * to Android's App Link resolution. If the app is missing or the browser blocks the launch, the visitor simply stays here - the
 * intent's fallback is this same page with webonly=1 (which never renders this component), and a sessionStorage mark stops a
 * second attempt on reload/back. Never a store redirect, never a timer. The explicit "Open in Juple" button stays the user-gesture
 * fallback for browsers that refuse an automatic launch.
 */
export function AutoOpenInApp({ intentUrl, guardKey }: { readonly intentUrl: string; readonly guardKey: string }) {
  useEffect(() => {
    try {
      if (window.sessionStorage.getItem(guardKey) === '1') {
        return;
      }
      window.sessionStorage.setItem(guardKey, '1');
    } catch {
      // Storage unavailable (some in-app browsers): the webonly fallback parameter still prevents any loop.
    }
    window.location.href = intentUrl;
  }, [intentUrl, guardKey]);

  return null;
}
