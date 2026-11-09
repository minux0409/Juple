// Local browser test of the Web renewal (the real AppShell, link list + selection, request buttons, membership) against a stub API.
// It never contacts PROD or Azure DEV. Screenshots go to RENEWAL_SCREENSHOT_DIR when it is set.
// Run: node --test tests/browser/webRenewal.browser.mjs
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, before, it } from 'node:test';
import { findChrome, openPage } from './cdp.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const harness = `${root}app/renewal-test-harness`;
const port = 3198;
const origin = `http://localhost:${port}`;
let server;
let owned = false;

before(async () => {
  assert.ok(findChrome(), 'Chrome is required for this explicit browser test');
  assert.equal(existsSync(harness), false, 'Preserve any existing harness directory');
  mkdirSync(harness);
  owned = true;
  writeFileSync(`${harness}/page.tsx`, readFileSync(`${root}tests/browser/harness/renewal.page.tsx.tpl`, 'utf8'));
  // The real shell, with only its route adapter replaced so a destination is active (/collections) on the test-only URL.
  const shell = readFileSync(`${root}app/(app)/AppShell.tsx`, 'utf8')
    .replace("from 'next/navigation'", "from './navigationStub'")
    .replace(/from '\.\/(?!navigationStub)/g, "from '../(app)/");
  writeFileSync(`${harness}/AppShell.tsx`, shell);
  writeFileSync(`${harness}/navigationStub.ts`, "export const usePathname = () => '/collections';");
  server = spawn(process.execPath, [`${root}node_modules/next/dist/bin/next`, 'dev', '-p', String(port)], { cwd: root, stdio: 'ignore', env: { ...process.env, NEXT_TELEMETRY_DISABLED: '1' } });
  for (let attempt = 0; attempt < 120; attempt++) {
    try {
      if ((await fetch(`${origin}/renewal-test-harness`)).status === 200) return;
    } catch {
      /* local startup */
    }
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  throw new Error('Local server startup timeout');
});

after(async () => {
  if (owned) {
    rmSync(harness, { recursive: true, force: true });
    for (let attempt = 0; attempt < 30; attempt++) {
      const validator = `${root}.next/dev/types/validator.ts`;
      if (!existsSync(validator) || !readFileSync(validator, 'utf8').includes('renewal-test-harness')) break;
      await new Promise(resolve => setTimeout(resolve, 300));
    }
  }
  if (server && process.platform === 'win32') {
    await new Promise(resolve => spawn('taskkill', ['/PID', String(server.pid), '/T', '/F'], { stdio: 'ignore' }).on('close', resolve));
  } else server?.kill();
});

let nextChromePort = 9740;
const open = async (query, width, theme) => {
  const tab = await openPage(findChrome(), `${origin}/renewal-test-harness?${query}`, nextChromePort++);
  await tab.send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: width < 600 });
  await tab.until(`!!document.querySelector('[data-select-check]') && !!document.querySelector('[data-fixture-membership] [data-plan]')`);
  // The real theme path: the stored 화면 모드 preference, applied before paint by the bootstrap script / ThemeProvider.
  await tab.evaluate(`localStorage.setItem('juple.themePreference', '${theme}')`);
  await tab.evaluate('location.reload()');
  await tab.until(`document.documentElement.dataset.theme === '${theme}' && !!document.querySelector('[data-select-check]') && !!document.querySelector('[data-fixture-membership] [data-plan]')`);
  // Let the entrance animations finish before measuring.
  await tab.wait(450);
  return tab;
};
const capture = async (tab, name) => {
  const dir = process.env.RENEWAL_SCREENSHOT_DIR;
  if (!dir) return;
  await tab.evaluate(`document.fonts.ready.then(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))`);
  mkdirSync(dir, { recursive: true });
  const shot = await tab.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
  writeFileSync(join(dir, `${name}.png`), Buffer.from(shot.result.data, 'base64'));
};

const insideButton = `(() => [...document.querySelectorAll('[data-request-action]')].every(button => {
  const box = button.getBoundingClientRect();
  return [...button.children].every(child => { const r = child.getBoundingClientRect(); return r.left >= box.left - 0.5 && r.right <= box.right + 0.5 && r.top >= box.top - 0.5 && r.bottom <= box.bottom + 0.5; });
}))()`;

for (const width of [360, 390, 768, 1024, 1440, 1920]) {
  for (const theme of ['light', 'dark']) {
    it(`layout at ${width}px ${theme}: no sideways scroll, request buttons keep icon / badge / chevron inside, plans readable`, async () => {
      const tab = await open('lang=ko&view=grid', width, theme);
      try {
        assert.equal(await tab.evaluate(`document.documentElement.scrollWidth <= innerWidth`), true, 'no horizontal page scroll');
        assert.equal(await tab.evaluate(insideButton), true);
        const sideBySide = await tab.evaluate(`(() => { const [a, b] = document.querySelectorAll('[data-request-action]'); return Math.abs(a.getBoundingClientRect().top - b.getBoundingClientRect().top) < 2; })()`);
        if (width >= 1024) assert.equal(sideBySide, true, 'two request buttons side by side on a wide screen');
        // The background of a card differs from the page (surface vs background) in both themes.
        const surfaces = await tab.evaluate(`(() => { const shell = getComputedStyle(document.querySelector('[data-sidebar]')); const card = getComputedStyle(document.querySelector('[data-plan]')); return [shell.backgroundColor, card.backgroundColor]; })()`);
        assert.notEqual(surfaces[1], 'rgba(0, 0, 0, 0)');
        const page = await tab.evaluate(`getComputedStyle(document.querySelector('[data-sidebar]')).backgroundColor`);
        assert.equal(await tab.evaluate(`getComputedStyle(document.querySelector('[data-plan]')).backgroundColor`) === 'rgb(255, 255, 255)', theme === 'light', `${theme} card surface`);
        void page;
        await capture(tab, `renewal-${width}-${theme}`);
      } finally {
        await tab.close();
      }
    });
  }
}

for (const lang of ['ko', 'en', 'ja', 'zh-Hans', 'vi', 'ar']) {
  for (const width of [360, 1440]) {
    it(`${lang} at ${width}px: long words wrap, nothing overflows`, async () => {
      const tab = await open(`lang=${lang}&view=list`, width, 'light');
      try {
        assert.equal(await tab.evaluate(`document.documentElement.scrollWidth <= innerWidth`), true);
        assert.equal(await tab.evaluate(insideButton), true);
        await capture(tab, `renewal-${lang}-${width}`);
      } finally {
        await tab.close();
      }
    });
  }
}

it('selection: the check starts it, a click on a card toggles instead of opening, Shift+click selects a range, Escape ends it', async () => {
  const tab = await open('lang=ko&view=grid', 1440, 'light');
  try {
    const before = await tab.evaluate('location.href');
    await tab.evaluate(`document.querySelectorAll('[data-select-check]')[0].click()`);
    await tab.until(`!!document.querySelector('[data-selection-bar]')`);
    assert.match(await tab.evaluate(`document.querySelector('[data-selection-count]').textContent`), /1/);
    // A plain click on another card now chooses it (no navigation).
    await tab.evaluate(`document.querySelectorAll('ul[data-selecting] > li')[1].querySelector('a').click()`);
    await tab.wait(150);
    assert.equal(await tab.evaluate('location.href'), before, 'the card did not open');
    assert.equal(await tab.evaluate(`document.querySelectorAll('li[data-selected="true"]').length`), 2);
    // Shift+click on the 5th card: 1..5 except the locked 6th (never selectable) - range from the anchor (card 2).
    await tab.evaluate(`document.querySelectorAll('[data-select-check]')[4].dispatchEvent(new MouseEvent('click', { bubbles: true, shiftKey: true }))`);
    await tab.wait(150);
    assert.equal(await tab.evaluate(`document.querySelectorAll('li[data-selected="true"]').length`), 5);
    // The locked card has no check at all.
    assert.equal(await tab.evaluate(`document.querySelectorAll('ul[data-selecting] > li')[5].querySelector('[data-select-check]')`), null);
    await capture(tab, 'renewal-selection-1440');
    // Delete asks first; the backdrop closes the question and deletes nothing.
    await tab.evaluate(`document.querySelector('[data-selection-action="delete"]').click()`);
    await tab.until(`!!document.querySelector('dialog[open]')`);
    await capture(tab, 'renewal-delete-confirm-1440');
    await tab.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: 5, y: 5, button: 'left', clickCount: 1 });
    await tab.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 5, y: 5, button: 'left', clickCount: 1 });
    await tab.until(`!document.querySelector('dialog[open]')`);
    const writes = await tab.evaluate(`JSON.parse(sessionStorage.getItem('calls') || '[]').filter(call => !call.startsWith('GET'))`);
    assert.deepEqual(writes, [], 'closing the question sent nothing');
    assert.equal(await tab.evaluate(`document.querySelectorAll('li[data-selected="true"]').length`), 5, 'the selection is kept');
    // Escape (no dialog open) ends the selection.
    await tab.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    await tab.until(`!document.querySelector('[data-selection-bar]')`);
  } finally {
    await tab.close();
  }
});

it('side bar: collapses to icons (remembered), the marker sits on the active destination, the narrow top bar has no marker', async () => {
  const tab = await open('lang=ko', 1440, 'light');
  try {
    const marker = await tab.evaluate(`(() => { const m = document.querySelector('nav [aria-hidden][style]'); const a = document.querySelector('nav [aria-current="page"]'); return m && a ? Math.abs(m.getBoundingClientRect().top - a.getBoundingClientRect().top) : -1; })()`);
    assert.ok(marker >= 0 && marker < 2, `marker offset ${marker}`);
    const wide = await tab.evaluate(`document.querySelector('header').getBoundingClientRect().width`);
    await tab.evaluate(`document.querySelector('[data-sidebar-toggle]').click()`);
    await tab.wait(450);
    const narrow = await tab.evaluate(`document.querySelector('header').getBoundingClientRect().width`);
    assert.ok(narrow < wide - 100, `${wide} -> ${narrow}`);
    assert.equal(await tab.evaluate(`localStorage.getItem('juple.web.sidebar')`), 'collapsed');
    assert.equal(await tab.evaluate(`document.documentElement.scrollWidth <= innerWidth`), true);
    await capture(tab, 'renewal-sidebar-collapsed-1440');
    await tab.evaluate(`document.querySelector('[data-sidebar-toggle]').click()`);
    await tab.wait(450);
    await tab.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 900, deviceScaleFactor: 1, mobile: true });
    await tab.wait(300);
    assert.equal(await tab.evaluate(`document.querySelector('nav [aria-hidden][style]')`), null, 'no marker in the top bar');
  } finally {
    await tab.close();
  }
});

for (const width of [1440, 390]) {
  it(`docked controls at ${width}px: the title scrolls away, the controls stay at the top (under the narrow top bar) on a raised surface`, async () => {
    const tab = await open('lang=ko&view=list', width, 'light');
    try {
      assert.equal(await tab.evaluate(`document.querySelector('[data-sticky-controls]').dataset.stuck ?? null`), null, 'not docked before scrolling');
      // Just past the docking point (a fixed distance could reach the end of the short fixture list, which ends the stickiness).
      await tab.evaluate(`(() => { const offset = parseFloat(getComputedStyle(document.querySelector('[data-sidebar]')).getPropertyValue('--shell-top-offset')) || 0; const box = document.querySelector('[data-sticky-controls]').getBoundingClientRect(); window.scrollTo(0, scrollY + box.top - offset + 120); })()`);
      await tab.until(`document.querySelector('[data-sticky-controls]').dataset.stuck === 'true'`);
      const top = await tab.evaluate(`document.querySelector('[data-sticky-controls]').getBoundingClientRect().top`);
      const offset = await tab.evaluate(`parseFloat(getComputedStyle(document.querySelector('[data-sidebar]')).getPropertyValue('--shell-top-offset')) || 0`);
      assert.ok(Math.abs(top - offset) < 2, `docked at ${top}, top bar ${offset}`);
      if (width < 861) assert.ok(offset > 0, 'the narrow top bar is accounted for');
      else assert.equal(offset, 0);
      assert.equal(await tab.evaluate(`document.documentElement.scrollWidth <= innerWidth`), true);
      await tab.wait(400);
      // Docked = an opaque surface (content passing under it never shows through).
      assert.equal(await tab.evaluate(`getComputedStyle(document.querySelector('[data-sticky-controls]')).backgroundColor`), 'rgb(255, 255, 255)');
      await tab.send('Page.captureScreenshot', { format: 'png' }).then(shot => {
        const dir = process.env.RENEWAL_SCREENSHOT_DIR;
        if (dir) writeFileSync(join(dir, `renewal-docked-${width}.png`), Buffer.from(shot.result.data, 'base64'));
      });
      await tab.evaluate(`window.scrollTo(0, 0)`);
      await tab.until(`document.querySelector('[data-sticky-controls]').dataset.stuck === undefined`);
    } finally {
      await tab.close();
    }
  });
}

for (const store of ['google', 'apple', 'unknown']) {
  it(`membership guidance for a ${store} subscription: only that store's page (or both texts and no link when unnamed)`, async () => {
    const tab = await open(`lang=ko&store=${store}`, 1440, 'light');
    try {
      const links = await tab.evaluate(`[...document.querySelectorAll('[data-fixture-membership] a')].map(a => a.href)`);
      const play = links.some(href => href.startsWith('https://play.google.com/store/account/subscriptions'));
      const apple = links.some(href => href.startsWith('https://apps.apple.com/account/subscriptions'));
      assert.deepEqual({ play, apple }, { play: store === 'google', apple: store === 'apple' });
      assert.equal(await tab.evaluate(`!!document.querySelector('[data-store-guide="unknown"]')`), store === 'unknown');
      // Nothing on the page can be bought.
      assert.equal(await tab.evaluate(`/구매하기|구독하기|결제하기/.test(document.querySelector('[data-fixture-membership]').textContent)`), false);
    } finally {
      await tab.close();
    }
  });
}
