'use client';

import { useEffect, useMemo, useRef } from 'react';

/**
 * A temporary object URL for a local file (a photo being previewed or cropped): created with the file, and revoked when the file changes
 * or the component goes away - so URLs never pile up. The revoke is deferred by one tick and cancelled if the same URL is used again at
 * once: React's development double-run of an effect (mount, cleanup, mount) must not revoke a URL that is still on screen.
 */
export function useObjectUrl(file: File | null): string | null {
  const url = useMemo(() => (file ? URL.createObjectURL(file) : null), [file]);
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  useEffect(() => {
    if (!url) {
      return undefined;
    }
    const pendingByUrl = timers.current;
    const pending = pendingByUrl.get(url);
    if (pending !== undefined) {
      clearTimeout(pending);
      pendingByUrl.delete(url);
    }
    return () => {
      pendingByUrl.set(
        url,
        setTimeout(() => {
          URL.revokeObjectURL(url);
          pendingByUrl.delete(url);
        }, 0),
      );
    };
  }, [url]);
  return url;
}
