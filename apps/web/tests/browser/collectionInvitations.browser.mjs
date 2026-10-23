// Local Mock browser test for the real CollectionsView + invitation modal; never contacts PROD or Azure DEV.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, before, it } from 'node:test';
import { findChrome, openPage } from './cdp.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const harness = `${root}app/invitation-test-harness`;
const origin = 'http://localhost:3198';
let server;
let owned = false;
before(async () => {
  assert.ok(findChrome(), 'Chrome is required for this explicit browser test');
  assert.equal(existsSync(harness), false, 'Preserve any existing harness directory');
  mkdirSync(harness);
  owned = true;
  copyFileSync(`${root}tests/browser/harness/invitations.page.tsx.tpl`, `${harness}/page.tsx`);
  server = spawn(process.execPath, [`${root}node_modules/next/dist/bin/next`, 'dev', '-p', '3198'], { cwd: root, stdio: 'ignore', env: { ...process.env, NEXT_TELEMETRY_DISABLED: '1' } });
  for (let attempt = 0; attempt < 90; attempt++) {
    try { if ((await fetch(`${origin}/invitation-test-harness`)).status === 200) return; } catch { /* local startup */ }
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  throw new Error('Local Mock server startup timeout');
});
after(async () => {
  if (owned) {
    unlinkSync(`${harness}/page.tsx`);
    rmdirSync(harness);
    // Let Next's watcher regenerate its dev route types before stopping it. Otherwise tsc
    // would retain an import of the test route that has just been removed. Keep other build files.
    for (let attempt = 0; attempt < 30; attempt++) {
      const validator = `${root}.next/dev/types/validator.ts`;
      if (!existsSync(validator) || !readFileSync(validator, 'utf8').includes('invitation-test-harness')) break;
      await new Promise(resolve => setTimeout(resolve, 300));
    }
  }
  if (server && process.platform === 'win32') {
    await new Promise(resolve => spawn('taskkill', ['/PID', String(server.pid), '/T', '/F'], { stdio: 'ignore' }).on('close', resolve));
  } else server?.kill();
});
const entry = `document.querySelector('section[aria-label="받은 초대 요청"] > button[aria-haspopup="dialog"]')`;
const row = id => `document.querySelector('[data-invitation-id="${id}"]')`;
const action = (id, index) => `${row(id)}.querySelectorAll('button')[${index}].click()`;
let nextChromePort = 9540;
const openFixture = url => openPage(findChrome(), url, nextChromePort++);
const capture = async (tab, name) => {
  if (!process.env.INVITATION_SCREENSHOT_DIR) return;
  await tab.evaluate(`document.fonts.ready.then(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))`);
  mkdirSync(process.env.INVITATION_SCREENSHOT_DIR, { recursive: true });
  const screenshot = await tab.send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(join(process.env.INVITATION_SCREENSHOT_DIR, `${name}.png`), Buffer.from(screenshot.result.data, 'base64'));
};
it('single card → all invitations modal → accept once → shared list → decline → stale request', async () => {
  const tab = await openFixture(`${origin}/invitation-test-harness`);
  try {
    await tab.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
    await tab.until(`document.body?.textContent.includes('Invitation notification')`);
    await tab.evaluate(`document.querySelector('a').click()`);
    await tab.until(`location.search.includes('tab=shared') && !!${row(1)}`);
    assert.equal(await tab.evaluate(`${entry}.textContent.trim()`), '받은 초대 요청3');
    assert.equal(await tab.evaluate(`document.querySelector('dialog[open]').textContent.includes('PDA')`), true);
    assert.equal(await tab.evaluate(`${row(1)}.textContent.includes('승인 후 추가')`), true, 'PascalCase roles from the existing PROD API keep their permission label');
    await capture(tab, 'desktop-multiple-modal');
    await tab.evaluate(`document.querySelector('dialog button[aria-label="닫기"]').click()`);
    await tab.until(`!document.querySelector('dialog[open]')`);
    assert.equal(await tab.evaluate(`document.querySelectorAll('[data-invitation-id]').length`), 0, 'individual invitation buttons do not leak onto the collection list');
    await capture(tab, 'desktop-card');
    const countBefore = JSON.parse(await tab.evaluate(`sessionStorage.getItem('invitationCalls')`)).length;
    await tab.evaluate(`${entry}.click()`);
    await tab.until(`!!${row(1)}`);
    assert.equal(JSON.parse(await tab.evaluate(`sessionStorage.getItem('invitationCalls')`)).length, countBefore, 'reopen uses retained list');
    // Both events occur before React can render disabled: the synchronous in-flight guard must handle them.
    await tab.evaluate(`${action(1, 1)}; ${action(1, 1)}`);
    await tab.until(`!${row(1)} && document.body.textContent.includes('Accepted collection')`);
    const calls = JSON.parse(await tab.evaluate(`sessionStorage.getItem('invitationCalls')`));
    assert.equal(calls.filter(call => call === 'POST /api/v1/collection-invitations/1/accept').length, 1);
    await tab.evaluate(action(2, 0));
    await tab.until(`!${row(2)} && !!${row(3)}`);
    await tab.evaluate(action(3, 1));
    await tab.until(`!document.querySelector('dialog[open]') && !${entry}`);
    assert.equal(await tab.evaluate(`document.body.textContent.includes('더 이상 유효하지 않은 초대입니다.')`), true);
    await capture(tab, 'desktop-zero-after-response');
  } finally { await tab.close(); }
});

it('zero invitations hides the card; notification entry still explains an already handled request', async () => {
  const tab = await openFixture(`${origin}/invitation-test-harness?tab=shared&fixtureCount=0&invitations=1`);
  try {
    await tab.until(`document.querySelector('dialog[open]')?.textContent.includes('받은 초대 요청이 없어요.')`);
    assert.equal(await tab.evaluate(`!!${entry}`), false);
    await tab.evaluate(`document.querySelector('dialog button[aria-label="닫기"]').click()`);
    await tab.until(`!document.querySelector('dialog[open]')`);
    assert.equal(await tab.evaluate(`document.body.textContent.includes('받은 초대 요청이 없어요.')`), false);
  } finally { await tab.close(); }
});

it('one invitation matches the Android card and popup at phone width; Escape preserves the list', async () => {
  const tab = await openFixture(`${origin}/invitation-test-harness?tab=shared&fixtureCount=1`);
  try {
    await tab.send('Emulation.setDeviceMetricsOverride', { width: 393, height: 852, deviceScaleFactor: 1, mobile: true });
    await tab.until(`!!${entry}`);
    await capture(tab, 'mobile-single-card');
    await tab.evaluate(`${entry}.click()`);
    await tab.until(`!!${row(1)}`);
    await capture(tab, 'mobile-single-modal');
    assert.equal(await tab.evaluate(`document.querySelector('dialog').scrollWidth <= document.querySelector('dialog').clientWidth`), true);
    await tab.key('Escape', 'Escape', 27);
    await tab.until(`!document.querySelector('dialog[open]')`);
    await tab.evaluate(`${entry}.click()`);
    await tab.until(`!!${row(1)}`);
    await tab.evaluate(action(1, 0));
    await tab.until(`!document.querySelector('dialog[open]') && !${entry}`);
  } finally { await tab.close(); }
});

it('many invitations scroll inside the popup; long names and action buttons fit at 320px', async () => {
  const tab = await openFixture(`${origin}/invitation-test-harness?tab=shared&fixtureCount=10`);
  try {
    await tab.send('Emulation.setDeviceMetricsOverride', { width: 320, height: 640, deviceScaleFactor: 1, mobile: true });
    await tab.until(`!!${entry}`);
    await tab.evaluate(`${entry}.click()`);
    await tab.until(`!!${row(10)}`);
    assert.equal(await tab.evaluate(`(() => { const body = document.querySelector('[data-modal-body]'); return body.scrollHeight > body.clientHeight && body.scrollWidth <= body.clientWidth; })()`), true);
    assert.equal(await tab.evaluate(`[...document.querySelectorAll('dialog button')].every(button => { const b = button.getBoundingClientRect(); const d = document.querySelector('dialog').getBoundingClientRect(); return b.left >= d.left && b.right <= d.right; })`), true);
    await capture(tab, 'mobile-multiple-scroll');
  } finally { await tab.close(); }
});

it('failed responses keep the invitation and recover; forbidden is not mistaken for accepted/stale', async () => {
  for (const status of [429, 403]) {
    const tab = await openFixture(`${origin}/invitation-test-harness?tab=shared&fixtureCount=1&fixtureFailure=${status}`);
    try {
      await tab.until(`!!${entry}`);
      await tab.evaluate(`${entry}.click()`);
      await tab.until(`!!${row(1)}`);
      await tab.evaluate(action(1, 1));
      await tab.until(`!!document.querySelector('dialog [role="status"]') && !${row(1)}.querySelector('button').disabled`);
      assert.equal(await tab.evaluate(`!!${row(1)} && !!document.querySelector('dialog[open]')`), true);
      assert.equal(await tab.evaluate(`document.body.textContent.includes('Accepted collection')`), false);
      await tab.evaluate(action(1, 0));
      await tab.until(`!document.querySelector('dialog[open]') && !${entry}`);
    } finally { await tab.close(); }
  }
});

it('session expiry still invokes the existing sign-in handling', async () => {
  const tab = await openFixture(`${origin}/invitation-test-harness?tab=shared&fixtureCount=1&fixtureFailure=401`);
  try {
    await tab.until(`!!${entry}`);
    await tab.evaluate(`${entry}.click()`);
    await tab.until(`!!${row(1)}`);
    await tab.evaluate(action(1, 1));
    await tab.until(`sessionStorage.getItem('sessionLost') === 'true'`);
    assert.equal(await tab.evaluate(`!!${row(1)}`), true);
  } finally { await tab.close(); }
});
