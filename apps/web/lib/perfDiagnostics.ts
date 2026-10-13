import type { ApiTiming } from './appApi';

/**
 * Browser performance diagnostics - for measuring a slow screen on the DEPLOYED Dev site (a production build). OFF unless the Web
 * container is given JUPLE_WEB_PERF_DIAGNOSTICS=true (Dev deployments only; Production never sets it) or the app runs under
 * `next dev`.
 *
 * Nothing leaves the browser: no request, no storage. What is collected lives in memory and in `window.__jupleperf`, and one
 * console.debug line per API call. Only the method, the ROUTE (numeric / identifier segments replaced by `{id}`), the NAMES of the
 * query parameters, the status and milliseconds are recorded - never a value, a search term, a header, a token or a body.
 *
 * Use (DevTools console on the Dev site):
 *   __jupleperf.reset('archive-time')   // right before the action (click / navigation)
 *   ... do the action ...
 *   __jupleperf.report()                // requests, order, waits, duplicates, sequential depth, first data, paint
 *   copy(JSON.stringify(__jupleperf.report(), null, 2))
 */

export interface PerfEntry {
  readonly seq: number;
  readonly method: string;
  /** The route with identifier segments as `{id}` - the same shape the Backend's request timing logs as a template. */
  readonly route: string;
  readonly queryKeys: readonly string[];
  readonly status: number | null;
  /** When the call started / ended, in ms since the last reset (page load before any reset). */
  readonly startMs: number;
  readonly endMs: number;
  readonly tokenMs: number;
  /** Request leaving until the response headers (network + the API's own work). */
  readonly waitMs: number;
  readonly bodyMs: number;
  readonly totalMs: number;
}

export interface PerfReport {
  readonly label: string | null;
  readonly marks: Readonly<Record<string, number>>;
  readonly requestCount: number;
  readonly entries: readonly PerfEntry[];
  /** The same method + route + query names more than once. */
  readonly duplicates: readonly { readonly key: string; readonly count: number }[];
  /** The longest chain of calls that each started only after the previous one ended (a sequential dependency, as seen from here). */
  readonly sequentialDepth: number;
  readonly sequentialChain: readonly string[];
  readonly firstDataMs: number | null;
  readonly totalApiWaitMs: number;
}

const ID_SEGMENT = /^(?:\d+|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[A-Za-z0-9_-]{22,})$/i;

/** `/api/v1/collections/123/items/456` -> `/api/v1/collections/{id}/items/{id}`. */
export function normalizeRoute(path: string): string {
  return path
    .split('?')[0]
    .split('/')
    .map(segment => (segment !== '' && ID_SEGMENT.test(segment) ? '{id}' : segment))
    .join('/');
}

/** A call that is part of getting the signed-in session ready or the shell's chrome, not the page's own data. */
function isChrome(route: string): boolean {
  return route === '/api/v1/users/me/bootstrap' || route.startsWith('/api/v1/users/me/profile') || route.startsWith('/api/v1/notifications');
}

export interface PerfRecorder {
  onApiTiming(timing: ApiTiming): void;
  /** Records a moment once (first wins), `atMs` being a performance.now() time (default now); `overwrite` keeps the latest instead. */
  mark(name: string, atMs?: number, overwrite?: boolean): void;
  reset(label?: string): void;
  report(): PerfReport;
}

export function createPerfRecorder(now: () => number = () => performance.now(), log: (line: string) => void = () => undefined): PerfRecorder {
  let origin = 0;
  let label: string | null = null;
  let seq = 0;
  let entries: PerfEntry[] = [];
  let marks: Record<string, number> = {};
  let bootstrapEnd: number | null = null;
  let firstData: number | null = null;

  const since = (t: number) => Math.max(0, Math.round(t - origin));

  return {
    onApiTiming(timing) {
      const end = now();
      const route = normalizeRoute(timing.path);
      const entry: PerfEntry = {
        seq: (seq += 1),
        method: timing.method,
        route,
        queryKeys: timing.queryKeys,
        status: timing.status,
        startMs: since(end - timing.totalMs),
        endMs: since(end),
        tokenMs: timing.tokenMs,
        waitMs: timing.waitMs,
        bodyMs: timing.bodyMs,
        totalMs: timing.totalMs,
      };
      entries.push(entry);
      if (bootstrapEnd === null && route === '/api/v1/users/me/bootstrap' && timing.status !== null && timing.status < 400) {
        bootstrapEnd = entry.endMs;
        marks.bootstrapEnd = entry.endMs;
      }
      if (firstData === null && bootstrapEnd !== null && !isChrome(route) && timing.status !== null && timing.status < 400) {
        firstData = entry.endMs;
      }
      log(
        `[Juple perf] ${timing.method} ${route}${timing.queryKeys.length ? `?${timing.queryKeys.join(',')}` : ''} ${timing.status ?? '-'} ` +
          `@${entry.startMs}ms token ${timing.tokenMs} | wait ${timing.waitMs} | body ${timing.bodyMs} | total ${timing.totalMs}ms`,
      );
    },

    mark(name, atMs, overwrite = false) {
      if (overwrite || marks[name] === undefined) {
        marks[name] = since(atMs ?? now());
      }
    },

    reset(next) {
      origin = now();
      label = next ?? null;
      seq = 0;
      entries = [];
      marks = {};
      bootstrapEnd = null;
      firstData = null;
    },

    report() {
      const counts = new Map<string, number>();
      for (const entry of entries) {
        const key = `${entry.method} ${entry.route}${entry.queryKeys.length ? `?${[...entry.queryKeys].sort().join(',')}` : ''}`;
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
      const duplicates = [...counts].filter(([, count]) => count > 1).map(([key, count]) => ({ key, count }));

      // Longest chain where each call started (within 5 ms tolerance) after the previous one ended.
      const ordered = [...entries].sort((a, b) => a.startMs - b.startMs);
      const depth: number[] = [];
      const previous: number[] = [];
      ordered.forEach((entry, index) => {
        depth[index] = 1;
        previous[index] = -1;
        for (let before = 0; before < index; before += 1) {
          if (ordered[before].endMs <= entry.startMs + 5 && depth[before] + 1 > depth[index]) {
            depth[index] = depth[before] + 1;
            previous[index] = before;
          }
        }
      });
      let best = -1;
      depth.forEach((value, index) => {
        if (best === -1 || value > depth[best]) {
          best = index;
        }
      });
      const chain: string[] = [];
      for (let cursor = best; cursor !== -1; cursor = previous[cursor]) {
        chain.unshift(`${ordered[cursor].method} ${ordered[cursor].route} (${ordered[cursor].totalMs}ms)`);
      }

      return {
        label,
        marks: { ...marks },
        requestCount: entries.length,
        entries: [...entries],
        duplicates,
        sequentialDepth: best === -1 ? 0 : depth[best],
        sequentialChain: chain,
        firstDataMs: firstData,
        totalApiWaitMs: entries.reduce((sum, entry) => sum + entry.totalMs, 0),
      };
    },
  };
}

let shared: PerfRecorder | null = null;

/**
 * The page's one recorder, also reachable as `window.__jupleperf` (and the browser's paint timings are added as marks). Call only
 * when diagnostics are enabled; on the server it returns a recorder that is never attached to anything.
 */
export function getPerfRecorder(): PerfRecorder {
  if (shared) {
    return shared;
  }
  const recorder = createPerfRecorder(
    () => performance.now(),
    line => console.debug(line),
  );
  shared = recorder;
  if (typeof window !== 'undefined') {
    (window as unknown as { __jupleperf: unknown }).__jupleperf = {
      report: () => recorder.report(),
      reset: (label?: string) => recorder.reset(label),
      entries: () => recorder.report().entries,
    };
    recorder.mark('pageStart');
    try {
      new PerformanceObserver(list => {
        for (const entry of list.getEntries()) {
          recorder.mark(entry.name === 'first-contentful-paint' ? 'firstContentfulPaint' : entry.name, entry.startTime);
        }
      }).observe({ type: 'paint', buffered: true });
      new PerformanceObserver(list => {
        const last = list.getEntries().at(-1);
        if (last) {
          // LCP is a moving target: the latest candidate replaces the mark.
          recorder.mark('largestContentfulPaint', last.startTime, true);
        }
      }).observe({ type: 'largest-contentful-paint', buffered: true });
    } catch {
      // An older browser without these entry types: the API timings still work.
    }
  }
  return recorder;
}
