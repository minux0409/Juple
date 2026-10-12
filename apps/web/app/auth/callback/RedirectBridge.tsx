'use client';

import { useEffect } from 'react';

/** Runs MSAL's redirect bridge once in the browser - it needs no configuration of its own (see @azure/msal-browser/redirect-bridge). */
export function RedirectBridge() {
  useEffect(() => {
    import('@azure/msal-browser/redirect-bridge')
      .then(({ broadcastResponseToMainFrame }) => broadcastResponseToMainFrame())
      .catch(() => {
        // Not a sign-in response (opened directly, or a stale link): there is nothing to hand back - go to the app's start page.
        window.location.replace('/');
      });
  }, []);

  return null;
}
