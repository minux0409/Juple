'use client';

import { useState } from 'react';

/**
 * A per-browser screen preference (a view mode, a sort) kept in localStorage - like the mobile per-device preferences, never account
 * data. Storage may be unavailable (private window, blocked site data): the choice then simply lasts for this page.
 * Only used by components that mount in the browser after sign-in, so the stored value can seed the first render.
 */
export function useStoredChoice<T extends string>(storageKey: string, parse: (stored: string | null) => T): readonly [T, (next: T) => void] {
  const [value, setValue] = useState<T>(() => {
    try {
      return parse(window.localStorage.getItem(storageKey));
    } catch {
      return parse(null);
    }
  });
  const choose = (next: T) => {
    setValue(next);
    try {
      window.localStorage.setItem(storageKey, next);
    } catch {
      // Storage unavailable: kept for this page only.
    }
  };
  return [value, choose] as const;
}
