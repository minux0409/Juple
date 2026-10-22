// Real-Chrome regression test for choosing a password-locked Collection in 새 링크 검토 (/items/new) and 링크 수정 (/items/[id]/edit).
//
// Run:  JUPLE_BROWSER_TEST=1 npm run test:browser      (needs Google Chrome; skipped otherwise, and never part of `npm test`)
//
// It mounts the REAL pages (NewLinkReviewView / ItemEditView with the real CollectionPicker, PasswordDialog and UnlockPanel) in
// `next dev` with a stubbed API, then drives Chrome: the unlock must only choose the Collection - never save the link, never leave or
// reload the page. The harness route is written to app/browser-test-harness for the run and always deleted afterwards.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { after, before, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { findChrome, openPage } from './cdp.mjs';

const webRoot = fileURLToPath(new URL('../../', import.meta.url));
const harnessDir = `${webRoot}app/browser-test-harness`;
const chrome = findChrome();
const enabled = process.env.JUPLE_BROWSER_TEST === '1' && chrome !== null;
const NEXT_PORT = 3199;
const origin = `http://localhost:${NEXT_PORT}`;
const REVIEW_URL = `${origin}/browser-test-harness/new?url=${encodeURIComponent('https://example.com/a')}`;
const EDIT_URL = `${origin}/browser-test-harness/edit`;
let server = null;
let chromePort = 9400;

before(async () => {
  if (!enabled) return;
  mkdirSync(`${harnessDir}/new`, { recursive: true });
  mkdirSync(`${harnessDir}/edit`, { recursive: true });
  copyFileSync(`${webRoot}tests/browser/harness/StubApp.tsx.tpl`, `${harnessDir}/StubApp.tsx`);
  copyFileSync(`${webRoot}tests/browser/harness/new.page.tsx.tpl`, `${harnessDir}/new/page.tsx`);
  copyFileSync(`${webRoot}tests/browser/harness/edit.page.tsx.tpl`, `${harnessDir}/edit/page.tsx`);
  server = spawn(process.execPath, [`${webRoot}node_modules/next/dist/bin/next`, 'dev', '-p', String(NEXT_PORT)], {
    cwd: webRoot,
    stdio: 'ignore',
    env: { ...process.env, NEXT_TELEMETRY_DISABLED: '1' },
  });
  for (let attempt = 0; attempt < 240; attempt += 1) {
    try {
      if ((await fetch(`${origin}/browser-test-harness/edit`)).status === 200) return;
    } catch {
      // not up yet
    }
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  throw new Error('next dev did not start');
});

after(async () => {
  if (server) {
    // The dev server spawns children: on Windows kill the whole tree.
    if (process.platform === 'win32') spawn('taskkill', ['/PID', String(server.pid), '/T', '/F'], { stdio: 'ignore' });
    else server.kill();
    await new Promise(resolve => setTimeout(resolve, 1500));
  }
  if (existsSync(harnessDir)) rmSync(harnessDir, { recursive: true, force: true });
  // next dev generated route types for the harness; left behind they would break `tsc --noEmit` (tsconfig includes .next/dev/types).
  if (enabled) rmSync(`${webRoot}.next/dev`, { recursive: true, force: true });
});

const PAGES = [
  { name: '새 링크 검토 (/items/new)', url: REVIEW_URL, kept: ['선택 안 함'], keptAfterUnlock: ['test'] },
  { name: '링크 수정 (/items/7/edit)', url: EDIT_URL, kept: ['plain'], keptAfterUnlock: ['plain', 'test'] },
];

const clickByText = text => `[...document.querySelectorAll('button')].find(b => b.textContent.trim() === ${JSON.stringify(text)}).click(); true`;

/** Opens the page in a fresh Chrome and arms the recorders (they live in sessionStorage, so a page load cannot erase the evidence). */
async function scenario(page, run) {
  chromePort += 1;
  const tab = await openPage(chrome, page.url, chromePort);
  const navigations = [];
  try {
    await tab.send('Page.enable');
    tab.onEvent(event => {
      if (event.method === 'Page.frameRequestedNavigation') navigations.push(`${event.params.reason} ${event.params.url}`);
    });
    await tab.until(`[...document.querySelectorAll('button')].some(b => b.textContent.trim() === 'test')`);
    await tab.evaluate(`window.__stillThisDocument = true; sessionStorage.removeItem('api'); sessionStorage.removeItem('writes'); true`);
    const state = async () =>
      JSON.parse(
        await tab.evaluate(`JSON.stringify({
          href: location.href,
          sameDocument: window.__stillThisDocument === true,
          pressed: [...document.querySelectorAll('[aria-pressed=true]')].map(b => b.textContent.trim()).filter(t => t !== ''),
          dialogOpen: !!document.querySelector('dialog[open]'),
          alerts: [...document.querySelectorAll('dialog [role=alert]')].map(a => a.textContent),
          api: JSON.parse(sessionStorage.getItem('api') ?? '[]'),
          writes: JSON.parse(sessionStorage.getItem('writes') ?? '[]'),
          nestedForms: document.querySelectorAll('form form').length,
          unlockInsideLinkForm: !!document.querySelector('dialog')?.closest('form'),
        })`),
      );
    await run({ tab, state, navigations });
  } finally {
    await tab.close();
  }
}

async function openPrompt(tab) {
  await tab.evaluate(clickByText('test'));
  await tab.until(`!!document.querySelector('dialog[open] input[type=password]')`);
  await tab.evaluate(`document.querySelector('dialog[open] input[type=password]').focus(); true`);
}
const type = (tab, text) => tab.send('Input.insertText', { text });
const unlockCalls = api => api.filter(call => call.endsWith('/unlock'));

for (const page of PAGES) {
  describe(`${page.name} - locked Collection (real Chrome)`, { skip: !enabled && 'set JUPLE_BROWSER_TEST=1 with Google Chrome installed' }, () => {
    for (const how of ['Enter', '잠금 해제 click']) {
      it(`right password + ${how}: only chooses the Collection - no save, no navigation, no reload`, async () => {
        await scenario(page, async ({ tab, state, navigations }) => {
          assert.deepEqual((await state()).pressed, page.kept);
          await openPrompt(tab);
          // The unlock form must not sit inside the link's form (that invalid nesting made Chrome submit the page itself).
          const open = await state();
          assert.equal(open.nestedForms, 0, 'no <form> inside a <form>');
          assert.equal(open.unlockInsideLinkForm, false);
          await type(tab, 'right');
          if (how === 'Enter') await tab.key('Enter', 'Enter', 13, '\r');
          else await tab.evaluate(`document.querySelector('dialog[open] button[type=submit]').click(); true`);
          await tab.until(`!document.querySelector('dialog[open]')`);
          await tab.wait(600);
          const after = await state();
          assert.deepEqual(navigations, [], 'no navigation of any kind (a native form submit shows up here)');
          assert.equal(after.href, page.url, 'the address (and its ?url=) is untouched');
          assert.equal(after.sameDocument, true, 'the page was not reloaded');
          assert.equal(unlockCalls(after.api).length, 1, 'exactly one password check');
          assert.deepEqual(after.writes, [], 'nothing was saved - saving stays the explicit 저장 button');
          assert.deepEqual(after.pressed, page.keptAfterUnlock, 'the locked Collection is chosen, earlier choices kept');
        });
      });
    }

    it('a wrong password shows the error only: dialog stays, nothing chosen, nothing saved, same page', async () => {
      await scenario(page, async ({ tab, state, navigations }) => {
        await openPrompt(tab);
        await type(tab, 'wrong');
        await tab.key('Enter', 'Enter', 13, '\r');
        await tab.until(`!!document.querySelector('dialog[open] [role=alert]')`);
        const after = await state();
        assert.deepEqual(navigations, []);
        assert.equal(after.sameDocument, true);
        assert.equal(after.dialogOpen, true);
        assert.equal(after.alerts.length, 1);
        assert.deepEqual(after.pressed, page.kept);
        assert.deepEqual(after.writes, []);
      });
    });

    for (const how of ['취소 button', 'Escape']) {
      it(`${how}: closes the prompt and keeps the choice, without any password check or save`, async () => {
        await scenario(page, async ({ tab, state, navigations }) => {
          await openPrompt(tab);
          if (how === 'Escape') await tab.key('Escape', 'Escape', 27);
          else await tab.evaluate(`[...document.querySelectorAll('dialog[open] button[type=button]')].find(b => b.textContent.trim() === '취소').click(); true`);
          await tab.until(`!document.querySelector('dialog[open]')`);
          const after = await state();
          assert.deepEqual(navigations, []);
          assert.equal(after.sameDocument, true);
          assert.deepEqual(after.pressed, page.kept);
          assert.equal(unlockCalls(after.api).length, 0);
          assert.deepEqual(after.writes, []);
        });
      });
    }

    it('a double click on 잠금 해제 checks the password once and still saves nothing', async () => {
      await scenario(page, async ({ tab, state, navigations }) => {
        await openPrompt(tab);
        await type(tab, 'right');
        await tab.evaluate(`document.querySelector('dialog[open] button[type=submit]').click(); true`);
        await tab.wait(60);
        await tab.evaluate(`document.querySelector('dialog[open] button[type=submit]')?.click(); true`);
        await tab.until(`!document.querySelector('dialog[open]')`);
        await tab.wait(600);
        const after = await state();
        assert.deepEqual(navigations, []);
        assert.equal(unlockCalls(after.api).length, 1);
        assert.deepEqual(after.writes, []);
        assert.deepEqual(after.pressed, page.keptAfterUnlock);
      });
    });

    it('an ordinary Collection is chosen and un-chosen as before, with no prompt', async () => {
      await scenario(page, async ({ tab, state, navigations }) => {
        const wasChosen = page.kept.includes('plain');
        await tab.evaluate(clickByText('plain'));
        await tab.wait(500);
        let after = await state();
        assert.equal(after.dialogOpen, false);
        assert.equal(after.pressed.includes('plain'), !wasChosen);
        await tab.evaluate(clickByText('plain'));
        await tab.wait(500);
        after = await state();
        assert.equal(after.pressed.includes('plain'), wasChosen);
        assert.deepEqual(navigations, []);
        assert.deepEqual(after.writes, []);
      });
    });
  });
}
