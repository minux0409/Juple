import assert from 'node:assert/strict';
import test from 'node:test';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { dataExportDownloadUrl, isDataExportDownloadPath, parseDataExportLinks, parseDataExportSummary } from '../lib/dataExport.ts';
import { parseDataExportEnabled, parseDataRetention } from '../lib/subscription.ts';

test('bootstrap retention and export flags are defensive', () => {
  assert.deepEqual(parseDataRetention({ phase: 'readOnly', basis: 'trialEnded', accessEndedAtUtc: 'a', deletionScheduledAtUtc: 'b', nextNoticeAtUtc: 'c', readOnly: true }), {
    phase: 'readOnly', basis: 'trialEnded', accessEndedAtUtc: 'a', deletionScheduledAtUtc: 'b', nextNoticeAtUtc: 'c', readOnly: true,
  });
  assert.equal(parseDataRetention({ phase: 'new-server-state' }), null);
  assert.equal(parseDataExportEnabled({ enabled: true }), true);
  assert.equal(parseDataExportEnabled({ enabled: 'true' }), false);
});

test('export responses cannot redirect a download to another host', () => {
  const path = `/api/v1/data-export/downloads#${'A'.repeat(43)}`;
  assert.equal(isDataExportDownloadPath(path), true);
  assert.equal(dataExportDownloadUrl('https://api.example.test/', path), `https://api.example.test${path}`);
  assert.equal(dataExportDownloadUrl('https://api.example.test', 'https://evil.example/file'), null);
  assert.equal(isDataExportDownloadPath(`/api/v1/data-export/downloads/${'A'.repeat(43)}`), false);
  assert.deepEqual(parseDataExportSummary({ links: 2, photos: -1 }), { links: 2, linksInTrash: 0, ownedCollections: 0, sharedCollectionsJoined: 0, comments: 0, photos: 0, photoBytes: 0 });
  assert.equal(parseDataExportLinks({ expiresAtUtc: 'x', files: [{ kind: 'data', fileName: 'x.zip', downloadPath: 'https://evil.example/file' }] }), null);
});

test('real browser handoff sends the capability only in a POST body, with no Referer or token in the resulting DOM', { timeout: 60_000 }, async () => {
  const browser = [process.env.CHROME_BIN ?? '', 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', '/usr/bin/chromium'].find(file => file && existsSync(file));
  assert.ok(browser, 'a local browser is required for the export security check');
  const source = readFileSync(new URL('../../../backend/src/Juple.Api/Controllers/DataExportController.cs', import.meta.url), 'utf8');
  const script = /public const string DownloadScript = "([^"]+)";/.exec(source)?.[1];
  assert.ok(script);
  const requests: { method: string; url: string; referer?: string; body: string }[] = [];
  const server = createServer(async (request, response) => {
    let body = '';
    for await (const chunk of request) body += chunk;
    requests.push({ method: request.method ?? '', url: request.url ?? '', referer: request.headers.referer, body });
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('Referrer-Policy', 'no-referrer');
    if (request.method === 'POST') {
      // End the navigation as HTML so headless --dump-dom exits; ZIP bytes/headers are covered by Backend tests.
      response.setHeader('Content-Type', 'text/html');
      response.end('<!doctype html><html><body>synthetic download response</body></html>');
      return;
    }
    response.setHeader('Content-Type', 'text/html; charset=utf-8');
    response.setHeader('Content-Security-Policy', `default-src 'none'; script-src 'sha256-${createHash('sha256').update(script).digest('base64')}'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'`);
    response.end(`<!doctype html><html><head><title>Juple</title></head><body><script>${script}</script></body></html>`);
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    const token = 'A'.repeat(43); // Synthetic, never an account's download capability.
    const profile = mkdtempSync(path.join(tmpdir(), 'juple-export-browser-'));
    const result = await promisify(execFile)(browser, ['--headless=new', '--disable-gpu', '--no-first-run', `--user-data-dir=${profile}`, '--virtual-time-budget=1500', '--dump-dom', `http://127.0.0.1:${address.port}/api/v1/data-export/downloads#${token}`], { timeout: 45_000 });
    const post = requests.find(request => request.method === 'POST');
    assert.ok(post, 'the browser must actually POST the token under the restrictive CSP');
    assert.equal(post.body, `token=${token}`);
    assert.equal(post.referer, undefined);
    assert.ok(requests.every(request => !request.url.includes(token)));
    assert.ok(!result.stdout.includes(token), 'the temporary form must be removed after submission');
  } finally {
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});
