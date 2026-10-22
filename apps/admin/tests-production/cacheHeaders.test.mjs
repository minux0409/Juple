import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { get } from 'node:http';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import { after, before, test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';

// Run after npm run build. Exercise Next's real routing/headers, not a copy of the route matcher.
const root = fileURLToPath(new URL('..', import.meta.url));
let child;
let base;
let html;

before(async () => {
  const socket = createServer();
  socket.listen(0, '127.0.0.1');
  await once(socket, 'listening');
  const port = socket.address().port;
  await new Promise(resolve => socket.close(resolve));
  base = `http://127.0.0.1:${port}`;
  child = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '--hostname', '127.0.0.1', '--port', String(port)], {
    cwd: root,
    env: {
      ...process.env,
      NODE_ENV: 'production',
      NEXT_TELEMETRY_DISABLED: '1',
      JUPLE_ADMIN_API_BASE_URL: 'https://api.example.test',
      JUPLE_ADMIN_ENTRA_AUTHORITY: 'https://test.ciamlogin.com',
      JUPLE_ADMIN_ENTRA_TENANT_ID: '00000000-0000-0000-0000-000000000001',
      JUPLE_ADMIN_ENTRA_CLIENT_ID: '00000000-0000-0000-0000-000000000002',
      JUPLE_ADMIN_ENTRA_API_SCOPE: 'api://00000000-0000-0000-0000-000000000003/access_as_user',
      JUPLE_ADMIN_BASE_URL: 'https://admin.example.test',
      JUPLE_ADMIN_BUILD_VERSION: 'cache-regression-local',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  let output = '';
  child.stdout.on('data', chunk => { output += chunk; });
  child.stderr.on('data', chunk => { output += chunk; });
  for (let attempt = 0; attempt < 100; attempt++) {
    if (child.exitCode !== null) throw new Error(`Local Next server exited: ${output}`);
    try {
      const response = await fetch(`${base}/health`, { signal: AbortSignal.timeout(1000) });
      if (response.ok) {
        html = await (await fetch(base)).text();
        return;
      }
    } catch { /* Wait only for this local server to start. */ }
    await delay(200);
  }
  throw new Error(`Local Next server startup timed out: ${output}`);
}, { timeout: 35000 });

after(async () => {
  if (child && child.exitCode === null) {
    const exited = once(child, 'exit');
    child.kill();
    await exited;
  }
});

test('admin HTML, health and similarly named routes remain uncacheable and protected', async () => {
  for (const path of ['/', '/users', '/health', '/auth/callback-other', '/_next/static-other/probe.js']) {
    const response = await fetch(`${base}${path}`);
    assert.match(response.headers.get('cache-control') ?? '', /no-store/, path);
    assert.equal(response.headers.get('x-frame-options'), 'DENY', path);
    assert.equal(response.headers.get('referrer-policy'), 'no-referrer', path);
  }
});

test('auth redirect bridge remains uncacheable with its same-origin frame exception', async () => {
  const response = await fetch(`${base}/auth/callback`);
  assert.equal(response.status, 200);
  assert.match(response.headers.get('cache-control') ?? '', /no-store/);
  assert.equal(response.headers.get('x-frame-options'), 'SAMEORIGIN');
  assert.match(response.headers.get('content-security-policy') ?? '', /frame-ancestors 'self'/);
});

test('actual versioned JS and CSS use Next immutable caching and retain security headers', async () => {
  const paths = [...html.matchAll(/(?:src|href)="([^"?]+\.(?:js|css))"/g)].map(match => match[1]);
  for (const extension of ['.js', '.css']) {
    const path = paths.find(value => value.startsWith('/_next/static/') && value.endsWith(extension));
    assert.ok(path, `HTML must reference ${extension}`);
    const response = await fetch(`${base}${path}`);
    assert.equal(response.status, 200);
    const cache = response.headers.get('cache-control') ?? '';
    assert.match(cache, /public/);
    assert.match(cache, /max-age=31536000/);
    assert.match(cache, /immutable/);
    assert.doesNotMatch(cache, /no-store/);
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(response.headers.get('x-frame-options'), 'DENY');
    assert.equal(response.headers.get('referrer-policy'), 'no-referrer');
    assert.equal(response.headers.get('x-robots-tag'), 'noindex, nofollow, noarchive');
    const etag = response.headers.get('etag');
    assert.ok(etag);
    // fetch adds Cache-Control: no-cache to conditional requests; use HTTP directly to test normal revalidation.
    const cachedStatus = await new Promise((resolve, reject) => {
      get(`${base}${path}`, { headers: { 'If-None-Match': etag } }, response => {
        response.resume();
        resolve(response.statusCode);
      }).on('error', reject);
    });
    assert.equal(cachedStatus, 304);
  }
});

test('missing build assets are not cached as immutable successful assets', async () => {
  const response = await fetch(`${base}/_next/static/chunks/nonexistent-cache-regression.js`);
  assert.equal(response.status, 404);
  assert.doesNotMatch(response.headers.get('cache-control') ?? '', /immutable|max-age=31536000/);
});
