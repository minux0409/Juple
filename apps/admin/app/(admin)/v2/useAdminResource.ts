'use client';

import { useCallback, useEffect, useState } from 'react';
import { failureMessage } from '../../../lib/adminModel';
import { useAdmin } from '../AdminRoot';

/**
 * One API read for the V2 screens, with a short in-memory cache and request de-duplication: switching back to a chart or a
 * user already seen is instant, and two components asking for the same path at once share one request. A late answer for a
 * path the screen has left is never shown. The cache lives in this browser tab's memory only (never storage) and a reload
 * always goes to the API again.
 */
const cache = new Map<string, { readonly at: number; readonly data: unknown }>();
const inflight = new Map<string, Promise<unknown>>();

export function clearAdminResourceCache(prefix = ''): void {
  for (const key of [...cache.keys()]) {
    if (key.startsWith(prefix)) {
      cache.delete(key);
    }
  }
}

export function useAdminResource<T>(path: string | null, ttlMs = 60_000) {
  const { api, reportFailure } = useAdmin();
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<{ readonly key: string | null; readonly data: T | null; readonly error: string | null; readonly done: boolean }>({
    key: null,
    data: null,
    error: null,
    done: false,
  });
  const key = path === null ? null : `${path}#${attempt}`;

  useEffect(() => {
    if (path === null || key === null) {
      return;
    }
    let cancelled = false;
    const hit = cache.get(path);
    if (hit && Date.now() - hit.at < ttlMs) {
      // A cached answer is applied asynchronously like a fetched one, so rendering never depends on the cache.
      queueMicrotask(() => {
        if (!cancelled) {
          setState({ key, data: hit.data as T, error: null, done: true });
        }
      });
      return () => {
        cancelled = true;
      };
    }
    let request = inflight.get(path) as Promise<T> | undefined;
    if (!request) {
      request = api<T>({ path });
      inflight.set(path, request);
      void request.then(
        data => cache.set(path, { at: Date.now(), data }),
        () => undefined,
      ).finally(() => inflight.delete(path));
    }
    request.then(
      data => {
        if (!cancelled) {
          setState({ key, data, error: null, done: true });
        }
      },
      (error: unknown) => {
        if (!cancelled) {
          reportFailure(error);
          setState(previous => ({ key, data: previous.key?.startsWith(`${path}#`) ? previous.data : null, error: failureMessage(error), done: true }));
        }
      },
    );
    return () => {
      cancelled = true;
    };
  }, [api, reportFailure, path, key, ttlMs]);

  const reload = useCallback(() => {
    if (path) {
      cache.delete(path);
    }
    setAttempt(value => value + 1);
  }, [path]);

  const samePath = path !== null && state.key !== null && state.key.startsWith(`${path}#`);
  const finished = state.key === key && state.done;
  return {
    /** Shown while a reload of the same path runs; never another path's data. */
    data: samePath ? state.data : null,
    error: finished ? state.error : null,
    loading: path !== null && !finished,
    reload,
  };
}
