import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import type { ApiTiming } from '../lib/appApi.ts';
import { createPerfRecorder, normalizeRoute } from '../lib/perfDiagnostics.ts';
import { readWebAppConfig } from '../lib/webAppConfig.ts';

const source = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

const ENV = {
  JUPLE_ENTRA_AUTHORITY: 'https://jupledev.ciamlogin.com',
  JUPLE_ENTRA_TENANT_ID: 'd2e79a05-cf5f-43ab-86d2-717e025a74b1',
  JUPLE_ENTRA_WEB_CLIENT_ID: 'd70ac03c-811e-4535-868e-9cb94d66db64',
  JUPLE_ENTRA_API_SCOPE: 'api://x/access_as_user',
  JUPLE_WEB_BASE_URL: 'https://dev.juple.co.kr',
};

function timing(path: string, totalMs: number, status: number | null = 200, method = 'GET'): ApiTiming {
  const [route, query = ''] = path.split('?');
  return { method, path: route, queryKeys: [...new URLSearchParams(query).keys()], status, tokenMs: 0, waitMs: totalMs - 5, bodyMs: 5, totalMs };
}

describe('perf diagnostics switch', () => {
  it('is off unless the runtime flag is exactly true; the Production default is off', () => {
    const flag = (value: string | undefined) => {
      const result = readWebAppConfig({ ...ENV, JUPLE_WEB_PERF_DIAGNOSTICS: value });
      return result.ok ? result.config.perfDiagnostics : 'not ok';
    };
    assert.equal(flag(undefined), false);
    assert.equal(flag(''), false);
    assert.equal(flag('false'), false);
    assert.equal(flag('1'), false);
    assert.equal(flag('true'), true);
    assert.equal(flag(' TRUE '), true);
  });

  it('the app records only when the flag (or next dev) says so, and nothing is sent anywhere', () => {
    const root = source('app/(app)/AppRoot.tsx');
    assert.match(root, /config\.perfDiagnostics \? getPerfRecorder\(\) : null/);
    assert.match(root, /onTiming: perf \? timing => perf\.onApiTiming\(timing\) : reportApiTimingInDevelopment/);
    const lib = source('lib/perfDiagnostics.ts');
    assert.doesNotMatch(lib, /fetch\(|sendBeacon|XMLHttpRequest|localStorage|sessionStorage|document\.cookie/);
  });
});

describe('perf diagnostics recorder', () => {
  it('replaces identifier segments, never keeps a query value', () => {
    assert.equal(normalizeRoute('/api/v1/collections/123/items/456?q=secret'), '/api/v1/collections/{id}/items/{id}');
    assert.equal(normalizeRoute('/api/v1/public/collections/AbCdEfGhIjKlMnOpQrStUv/unlock'), '/api/v1/public/collections/{id}/unlock');
    assert.equal(normalizeRoute('/api/v1/items/history/sections'), '/api/v1/items/history/sections');
  });

  it('counts requests, finds duplicates and the sequential chain, and the first page data after bootstrap', () => {
    let clock = 0;
    const lines: string[] = [];
    const recorder = createPerfRecorder(() => clock, line => void lines.push(line));
    recorder.reset('archive-time');
    // bootstrap 0..100, then profile + sections in parallel (100..160 / 100..180), then the first page (180..260).
    clock = 100;
    recorder.onApiTiming(timing('/api/v1/users/me/bootstrap', 100, 200, 'POST'));
    clock = 160;
    recorder.onApiTiming(timing('/api/v1/users/me/profile', 60));
    clock = 180;
    recorder.onApiTiming(timing('/api/v1/items/history/sections', 80));
    clock = 260;
    recorder.onApiTiming(timing('/api/v1/items/history?limit=30&q=my%20private%20term', 80));
    clock = 300;
    recorder.onApiTiming(timing('/api/v1/items/history?limit=30&q=other', 100));
    const report = recorder.report();

    assert.equal(report.label, 'archive-time');
    assert.equal(report.requestCount, 5);
    assert.deepEqual(report.duplicates, [{ key: 'GET /api/v1/items/history?limit,q', count: 2 }]);
    assert.equal(report.marks.bootstrapEnd, 100);
    assert.equal(report.firstDataMs, 180, 'the profile (chrome) is not page data; the first page call is');
    assert.equal(report.sequentialDepth, 3, 'bootstrap -> sections -> first page');
    const steps = report.sequentialChain.map(step => step.split(' (')[0]);
    assert.equal(steps[0], 'POST /api/v1/users/me/bootstrap');
    assert.equal(steps.at(-1), 'GET /api/v1/items/history');
    assert.doesNotMatch(JSON.stringify(report) + lines.join('\n'), /private|secret|term/, 'no query value anywhere');
  });

  it('marks are first-wins unless overwritten, and reset clears everything', () => {
    let clock = 10;
    const recorder = createPerfRecorder(() => clock);
    recorder.mark('authReady');
    clock = 50;
    recorder.mark('authReady');
    recorder.mark('largestContentfulPaint', 30);
    recorder.mark('largestContentfulPaint', 40, true);
    assert.deepEqual(recorder.report().marks, { authReady: 10, largestContentfulPaint: 40 });
    recorder.reset();
    assert.deepEqual(recorder.report().marks, {});
    assert.equal(recorder.report().requestCount, 0);
  });
});
