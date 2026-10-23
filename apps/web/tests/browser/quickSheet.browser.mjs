// Local Mock browser test for the real Quick Detail sheet (own link, own link in a Collection, another member link); never contacts PROD or Azure DEV.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, before, it } from 'node:test';
import { findChrome, openPage } from './cdp.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const harness = `${root}app/quick-sheet-test-harness`;
const origin = 'http://localhost:3199';
let server;
let owned = false;
before(async () => {
  assert.ok(findChrome(), 'Chrome is required for this explicit browser test');
  assert.equal(existsSync(harness), false, 'Preserve any existing harness directory');
  mkdirSync(harness);
  owned = true;
  copyFileSync(`${root}tests/browser/harness/quick.page.tsx.tpl`, `${harness}/page.tsx`);
  server = spawn(process.execPath, [`${root}node_modules/next/dist/bin/next`, 'dev', '-p', '3199'], { cwd: root, stdio: 'ignore', env: { ...process.env, NEXT_TELEMETRY_DISABLED: '1' } });
  for (let attempt = 0; attempt < 90; attempt++) {
    try { if ((await fetch(`${origin}/quick-sheet-test-harness`)).status === 200) return; } catch { /* local startup */ }
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
      if (!existsSync(validator) || !readFileSync(validator, 'utf8').includes('quick-sheet-test-harness')) break;
      await new Promise(resolve => setTimeout(resolve, 300));
    }
  }
  if (server && process.platform === 'win32') {
    await new Promise(resolve => spawn('taskkill', ['/PID', String(server.pid), '/T', '/F'], { stdio: 'ignore' }).on('close', resolve));
  } else server?.kill();
});

let nextChromePort = 9640;
const openFixture = url => openPage(findChrome(), url, nextChromePort++);

/** Opens the sheet on `kind` and records every frame's panel size until the content settled; returns the samples and the DOM facts. */
async function measure(kind, { delay = 150, failure = false, width = 1280, height = 900 } = {}) {
  const tab = await openFixture(`${origin}/quick-sheet-test-harness?kind=${kind}&delay=${delay}${failure ? '&failure=1' : ''}`);
  try {
    const errors = [];
    tab.onEvent(event => {
      if (event.method === 'Runtime.exceptionThrown') errors.push(event.params.exceptionDetails.text + ' ' + (event.params.exceptionDetails.exception?.description ?? '').slice(0, 200));
      if (event.method === 'Runtime.consoleAPICalled' && event.params.type === 'error') errors.push(event.params.args.map(arg => arg.value ?? arg.description).join(' ').slice(0, 300));
    });
    await tab.send('Runtime.enable');
    await tab.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: width < 600 });
    await tab.until(`!!document.querySelector('[data-open-sheet]') && Object.keys(document.querySelector('[data-open-sheet]')).some(key => key.startsWith('__reactProps'))`);
    await tab.evaluate(`document.querySelector('[data-open-sheet]').click()`);
    await tab.until(`!!document.querySelector('dialog[open]')`);
    // Settled = the real content (or its failure) is there, plus time for comments / images / animations.
    await tab.until(failure ? `!!document.querySelector('dialog[open] [role=alert], dialog[open] button')` : `!!document.querySelector('[data-item-detail]')`, 30_000);
    await tab.wait(delay * 3 + 1200);
    if (process.env.QUICK_SCREENSHOT_DIR) {
      mkdirSync(process.env.QUICK_SCREENSHOT_DIR, { recursive: true });
      const shot = await tab.send('Page.captureScreenshot', { format: 'png' });
      writeFileSync(join(process.env.QUICK_SCREENSHOT_DIR, `quick-${kind}-${width}${failure ? '-failed' : ''}.png`), Buffer.from(shot.result.data, 'base64'));
    }
    const samples = await tab.evaluate(`window.__samples ?? []`);
    const facts = await tab.evaluate(`({ mounts: Number(document.querySelector('[data-mounts]').textContent), calls: JSON.parse(sessionStorage.getItem('quickCalls') ?? '[]'), noOverflow: document.documentElement.scrollWidth <= innerWidth, vh: innerHeight })`);
    const heights = samples.map(sample => sample.h);
    if (errors.length > 0) console.log('# page errors:', JSON.stringify(errors.slice(0, 3)));
    return { samples, heights, facts, min: Math.min(...heights), max: Math.max(...heights), first: heights[0], last: heights[heights.length - 1], distinct: [...new Set(heights)] };
  } finally { await tab.close(); }
}

for (const kind of ['item', 'own-in-collection', 'shared']) {
  it(`Quick Detail (${kind}): the sheet keeps ONE size from the first frame to the end - loading, data, comments - on a slow network too`, async () => {
    for (const delay of [150, 900]) {
      const r = await measure(kind, { delay });
      console.log(`# ${kind} delay=${delay}: first=${r.first}px last=${r.last}px min=${r.min} max=${r.max} distinct=${JSON.stringify(r.distinct.slice(0, 8))} mounts=${r.facts.mounts} frames=${r.heights.length}`);
      assert.ok(r.max - r.min <= 2, `${kind} (delay ${delay}): the panel changed size while loading - ${JSON.stringify(r.distinct)}`);
      assert.equal(r.facts.mounts, 1, 'the sheet content is mounted once, never replaced');
      assert.equal(r.facts.noOverflow, true);
    }
  });
}

it('Quick Detail: a failing read keeps the very same size as the loading state (no collapse, no jump)', async () => {
  const ok = await measure('shared', { delay: 300 });
  const failed = await measure('shared', { delay: 300, failure: true });
  console.log(`# failure: ${JSON.stringify(failed.distinct)} vs loaded ${JSON.stringify(ok.distinct)}`);
  assert.ok(failed.max - failed.min <= 2, `failure: no size change ${JSON.stringify(failed.distinct)}`);
  assert.ok(Math.abs(failed.last - ok.last) <= 2, 'the same size as the loaded sheet');
});

it('Quick Detail: the same size on a phone and a narrow window (393 / 320), scrolling inside instead of growing', async () => {
  for (const width of [393, 320]) {
    for (const kind of ['item', 'shared']) {
      const r = await measure(kind, { delay: 600, width, height: 800 });
      console.log(`# ${kind} ${width}px: distinct=${JSON.stringify(r.distinct)} vh=${r.facts.vh}`);
      assert.ok(r.max - r.min <= 2, `${kind} ${width}: ${JSON.stringify(r.distinct)}`);
      assert.ok(r.max <= r.facts.vh * 0.92, `${kind} ${width}: the sheet stays inside the screen`);
      assert.equal(r.facts.noOverflow, true);
    }
  }
});

/** Opens another member's link in the sheet as `role` and returns the tab, the sheet's menu entries and a way to click them. */
async function openShared(role, extra = '') {
  const tab = await openFixture(`${origin}/quick-sheet-test-harness?kind=shared&delay=100&role=${role}${extra}`);
  await tab.until(`!!document.querySelector('[data-open-sheet]') && Object.keys(document.querySelector('[data-open-sheet]')).some(key => key.startsWith('__reactProps'))`);
  await tab.evaluate(`document.querySelector('[data-open-sheet]').click()`);
  await tab.until(`!!document.querySelector('[data-item-detail]')`);
  await tab.until(`Object.keys(document.querySelector('[aria-label="링크 작업"]')).some(key => key.startsWith('__reactProps'))`);
  // The role is read once, right after the link: let it settle before looking at the menu.
  await tab.wait(700);
  const menu = async () => {
    await tab.evaluate(`document.querySelector('[aria-label="링크 작업"]').click()`);
    await tab.wait(200);
    return tab.evaluate(`[...document.querySelectorAll('[role="menuitem"], [role="menu"] button')].map(el => el.textContent.trim())`);
  };
  return { tab, menu };
}

it('다른 사람의 링크 (Web): the Collection Owner gets 컬렉션에서 제거 - it asks first, then removes only the membership (never the Item)', async () => {
  const { tab, menu } = await openShared('owner');
  try {
    const entries = await menu();
    assert.ok(entries.some(text => text.includes('컬렉션에서')), `the Owner's menu offers removal: ${JSON.stringify(entries)}`);
    await tab.evaluate(`[...document.querySelectorAll('[role="menuitem"], [role="menu"] button')].find(el => el.textContent.includes('컬렉션에서')).click()`);
    await tab.until(`!!document.querySelector('dialog[open] h2')`);
    const dialog = await tab.evaluate(`document.querySelector('dialog[open]').textContent`);
    assert.ok(dialog.includes('삭제되지 않고') || dialog.includes('not deleted'), `the dialog says only the Collection loses it: ${dialog}`);
    assert.equal(JSON.parse(await tab.evaluate(`sessionStorage.getItem('quickCalls')`)).some(call => call.startsWith('DELETE')), false, 'nothing is removed before the confirmation');
    await tab.evaluate(`[...document.querySelectorAll('dialog[open] button')].find(el => el.textContent.includes('컬렉션에서') && !el.getAttribute('aria-label')).click()`);
    await tab.until(`JSON.parse(sessionStorage.getItem('quickChanges') ?? '[]').length === 1`);
    const calls = JSON.parse(await tab.evaluate(`sessionStorage.getItem('quickCalls')`)).filter(call => call.startsWith('DELETE'));
    assert.deepEqual(calls, ['DELETE /api/v1/collections/10/items/2'], 'the membership endpoint only - never DELETE /items/{id}');
    assert.deepEqual(JSON.parse(await tab.evaluate(`sessionStorage.getItem('quickChanges')`)), [{ kind: 'removedFromCollection', itemId: 2, collectionId: 10 }], 'the list hears "removed from this Collection", not "deleted"');
  } finally { await tab.close(); }
});

it('다른 사람의 링크 (Web): a plain member is offered no removal at all (and the sheet stays read-only)', async () => {
  const { tab, menu } = await openShared('contributor');
  try {
    const entries = await menu();
    assert.ok(!entries.some(text => text.includes('컬렉션에서')), `no removal for a member: ${JSON.stringify(entries)}`);
    assert.equal(JSON.parse(await tab.evaluate(`sessionStorage.getItem('quickCalls')`)).some(call => call.startsWith('DELETE')), false);
  } finally { await tab.close(); }
});

it('다른 사람의 링크 (Web): when the server refuses the removal nothing disappears and the Collection hears nothing', async () => {
  const { tab, menu } = await openShared('owner', '&deleteFails=1');
  try {
    await menu();
    await tab.evaluate(`[...document.querySelectorAll('[role="menuitem"], [role="menu"] button')].find(el => el.textContent.includes('컬렉션에서')).click()`);
    await tab.until(`!!document.querySelector('dialog[open] h2')`);
    await tab.evaluate(`[...document.querySelectorAll('dialog[open] button')].find(el => el.textContent.includes('컬렉션에서') && !el.getAttribute('aria-label')).click()`);
    await tab.until(`JSON.parse(sessionStorage.getItem('quickCalls')).some(call => call.startsWith('DELETE'))`);
    await tab.wait(800);
    assert.deepEqual(JSON.parse(await tab.evaluate(`sessionStorage.getItem('quickChanges') ?? '[]'`)), [], 'no "removed" signal after a refusal');
    assert.equal(await tab.evaluate(`!!document.querySelector('[data-item-detail]')`), true, 'the link is still shown');
  } finally { await tab.close(); }
});
