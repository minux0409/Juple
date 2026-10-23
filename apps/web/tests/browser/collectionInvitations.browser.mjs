// Local Mock browser test for the real CollectionsView + invitation modal; never contacts PROD or Azure DEV.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmdirSync, unlinkSync } from 'node:fs';
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
const click = text => `[...document.querySelectorAll('button')].find(button => button.textContent.trim() === ${JSON.stringify(text)}).click()`;
it('notification route → count/details → accept once → shared list → decline → stale request', async () => {
  const tab = await openPage(findChrome(), `${origin}/invitation-test-harness`, 9498);
  try {
    await tab.until(`document.body?.textContent.includes('Invitation notification')`);
    await tab.evaluate(`document.querySelector('a').click()`);
    await tab.until(`location.search.includes('tab=shared') && document.body?.textContent.includes('Invite 1')`);
    assert.equal(await tab.evaluate(`document.querySelector('[aria-label="받은 초대 요청"] h2').textContent.trim()`), '받은 초대 요청 3');
    await tab.evaluate(click('Invite 1 · Test owner'));
    await tab.until(`!!document.querySelector('dialog[open]')`);
    assert.equal(await tab.evaluate(`document.querySelector('dialog[open]').textContent.includes('Test owner')`), true);
    // Both events occur before React can render disabled: the synchronous in-flight guard must handle them.
    await tab.evaluate(`${click('수락')}; ${click('수락')}`);
    await tab.until(`!document.querySelector('dialog[open]') && document.body.textContent.includes('Accepted collection')`);
    const calls = JSON.parse(await tab.evaluate(`sessionStorage.getItem('invitationCalls')`));
    assert.equal(calls.filter(call => call === 'POST /api/v1/collection-invitations/1/accept').length, 1);
    await tab.evaluate(click('Invite 2 · Test owner'));
    await tab.until(`!!document.querySelector('dialog[open]')`);
    await tab.evaluate(click('거절'));
    await tab.until(`!document.querySelector('dialog[open]') && !document.body.textContent.includes('Invite 2')`);
    await tab.evaluate(click('Invite 3 · Test owner'));
    await tab.until(`!!document.querySelector('dialog[open]')`);
    await tab.evaluate(click('수락'));
    await tab.until(`!document.querySelector('dialog[open]') && document.body.textContent.includes('받은 초대 요청이 없어요.')`);
    assert.equal(await tab.evaluate(`document.body.textContent.includes('더 이상 유효하지 않은 초대입니다.')`), true);
  } finally { await tab.close(); }
});
