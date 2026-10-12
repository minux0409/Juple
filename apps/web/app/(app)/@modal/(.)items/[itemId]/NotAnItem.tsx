'use client';

import { useEffect } from 'react';

/**
 * The intercepting route also matches addresses that are not a link (/items/new): a soft navigation to one stays on the old page with
 * only the address changed. Loading that address for real shows the right page - never reached by Home's own entry (a full navigation),
 * this only keeps any other soft entry from leaving a dead screen.
 */
export function NotAnItem() {
  useEffect(() => {
    window.location.reload();
  }, []);
  return null;
}
