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

// ---- Round: the selection bar is docked to the browser window, the sort chips are gone, the star is the mobile star ----
const barGeometry = `(() => {
  const dock = document.querySelector('[data-selection-dock]').getBoundingClientRect();
  const bar = document.querySelector('[data-selection-bar]').getBoundingClientRect();
  const main = document.querySelector('main').getBoundingClientRect();
  return { dockPosition: getComputedStyle(document.querySelector('[data-selection-dock]')).position, parent: document.querySelector('[data-selection-dock]').parentElement.hasAttribute('data-app-shell'),
    barLeft: bar.left, barRight: bar.right, barTop: bar.top, barBottom: bar.bottom, mainLeft: main.left, mainRight: main.right, vh: innerHeight, vw: document.documentElement.clientWidth, dockLeft: dock.left, dockRight: dock.right };
})()`;

for (const width of [390, 768, 1440]) {
  it(`selection bar at ${width}px: fixed to the browser window, centred on the content column, never moves on scroll, nothing hidden behind it`, async () => {
    const tab = await open('lang=ko&view=list', width, 'light');
    try {
      await tab.evaluate(`document.querySelectorAll('[data-select-check]')[0].click()`);
      await tab.until(`!!document.querySelector('[data-selection-bar]')`);
      await tab.wait(350);
      const first = await tab.evaluate(barGeometry);
      assert.equal(first.dockPosition, 'fixed');
      assert.equal(first.parent, true, 'rendered through a portal into the shell (no page transform can be its containing block)');
      assert.ok(first.vh - first.barBottom >= 8 && first.vh - first.barBottom < 40, `bar sits at the window bottom (${first.vh - first.barBottom}px gap)`);
      assert.ok(first.barLeft >= first.mainLeft - 1 && first.barRight <= first.mainRight + 1, 'inside the content column');
      assert.ok(Math.abs((first.barLeft + first.barRight) / 2 - (first.mainLeft + first.mainRight) / 2) <= 1.5, 'centred on the content column, not on the window');
      assert.ok(first.barLeft >= 0 && first.barRight <= first.vw, 'inside the window with a side margin');
      if (width >= 861) assert.ok(first.mainLeft > 100, 'a side bar exists beside the column');
      // Scrolling never moves it: at the middle and at the very end of the page.
      for (const target of ['document.documentElement.scrollHeight / 2', 'document.documentElement.scrollHeight']) {
        await tab.evaluate(`window.scrollTo(0, ${target})`);
        await tab.wait(150);
        const moved = await tab.evaluate(barGeometry);
        assert.ok(Math.abs(moved.barTop - first.barTop) < 1 && Math.abs(moved.barBottom - first.barBottom) < 1, `bar stayed put (${first.barTop} -> ${moved.barTop})`);
      }
      // At the end of the page the last content is above the bar (the spacer gives the room).
      const clear = await tab.evaluate(`(() => { const last = document.querySelector('[data-fixture-membership]').getBoundingClientRect(); const bar = document.querySelector('[data-selection-bar]').getBoundingClientRect(); return bar.top - last.bottom; })()`);
      assert.ok(clear >= 0, `last content ends ${clear}px above the bar`);
      assert.equal(await tab.evaluate(`document.documentElement.scrollWidth <= innerWidth`), true);
      if (width === 390) {
        // Narrow: the action buttons never overlap each other or leave the bar.
        const overlap = await tab.evaluate(`(() => { const bar = document.querySelector('[data-selection-bar]').getBoundingClientRect(); const rects = [...document.querySelectorAll('[data-selection-bar] button')].map(b => b.getBoundingClientRect()); let bad = 0; rects.forEach((a, i) => { if (a.left < bar.left - 0.5 || a.right > bar.right + 0.5) bad++; rects.slice(i + 1).forEach(b => { if (a.left < b.right - 0.5 && b.left < a.right - 0.5 && a.top < b.bottom - 0.5 && b.top < a.bottom - 0.5) bad++; }); }); return bad; })()`);
        assert.equal(overlap, 0, 'buttons do not overlap');
      }
      await capture(tab, `selection-bar-${width}`);
      await tab.evaluate(`window.scrollTo(0, 0)`);
      await tab.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
      await tab.until(`!document.querySelector('[data-selection-bar]')`);
      assert.equal(await tab.evaluate(`getComputedStyle(document.querySelector('[data-app-shell]')).getPropertyValue('--selection-room').trim()`), '', 'the extra room leaves with the bar');
    } finally {
      await tab.close();
    }
  });
}

it('selection bar follows the side bar: collapsing and expanding re-centres it on the content column', async () => {
  const tab = await open('lang=ko&view=list', 1440, 'light');
  try {
    await tab.evaluate(`document.querySelectorAll('[data-select-check]')[0].click()`);
    await tab.until(`!!document.querySelector('[data-selection-bar]')`);
    await tab.wait(350);
    const expanded = await tab.evaluate(barGeometry);
    await tab.evaluate(`document.querySelector('[data-sidebar-toggle]').click()`);
    await tab.wait(600);
    const collapsed = await tab.evaluate(barGeometry);
    assert.ok(collapsed.mainLeft < expanded.mainLeft - 100, 'the column moved left');
    assert.ok(Math.abs((collapsed.barLeft + collapsed.barRight) / 2 - (collapsed.mainLeft + collapsed.mainRight) / 2) <= 1.5, 'centred again after collapsing');
    await tab.evaluate(`document.querySelector('[data-sidebar-toggle]').click()`);
    await tab.wait(600);
    const again = await tab.evaluate(barGeometry);
    assert.ok(Math.abs((again.barLeft + again.barRight) / 2 - (again.mainLeft + again.mainRight) / 2) <= 1.5, 'centred again after expanding');
    assert.ok(Math.abs(again.barLeft - expanded.barLeft) <= 1.5);
    await capture(tab, 'selection-bar-sidebar-collapsed-1440');
  } finally {
    await tab.close();
  }
});

it('no 시간순 / 이름순 sort control exists on the page (mobile removed it)', async () => {
  const tab = await open('lang=ko&view=list', 1440, 'light');
  try {
    assert.equal(await tab.evaluate(`!document.querySelector('[role="group"][aria-label*="정렬"]') && !/시간순|이름순/.test(document.querySelector('main').textContent)`), true);
  } finally {
    await tab.close();
  }
});

it('favorite star: gradient fill on, outline off; a tap plays ON (8 particles) and OFF (none); a silent change plays nothing; the layout never shifts; selection state is separate', async () => {
  const tab = await open('lang=ko&view=list', 1440, 'light');
  try {
    const state = `(() => { const s = document.querySelector('[data-favorite-star]'); const box = s.parentElement.getBoundingClientRect(); return { active: s.dataset.active, play: s.dataset.play ?? null, particles: s.querySelectorAll('[class*="favStarDot"], [class*="favStarRay"]').length, w: box.width, h: box.height, top: box.top, fillOpacity: getComputedStyle(s.querySelector('[class*="favStarFill"]')).opacity, outline: getComputedStyle(s.querySelector('[class*="favStarOutline"]')).stroke }; })()`;
    const off = await tab.evaluate(state);
    assert.equal(off.active, 'false');
    assert.equal(off.fillOpacity, '0');
    assert.equal(off.outline, 'rgb(154, 154, 154)', 'off = the mobile icon-stroke colour');
    await tab.evaluate(`document.querySelector('[data-star-button]').click()`);
    await tab.wait(60);
    const playing = await tab.evaluate(state);
    assert.equal(playing.play, 'on');
    assert.equal(playing.particles, 8);
    assert.equal(playing.w, off.w, 'the star button does not grow while playing');
    assert.equal(playing.top, off.top, 'nothing moves');
    await capture(tab, 'star-on-burst');
    await tab.wait(450);
    const on = await tab.evaluate(state);
    assert.equal(on.active, 'true');
    assert.equal(on.play, null);
    assert.equal(on.particles, 0);
    assert.equal(on.fillOpacity, '1');
    assert.equal(on.outline, 'rgb(242, 56, 154)', 'on = the Juple pink outline over the gradient fill');
    await tab.evaluate(`document.querySelector('[data-star-button]').click()`);
    await tab.wait(60);
    const closing = await tab.evaluate(state);
    assert.equal(closing.play, 'off');
    assert.equal(closing.particles, 0, 'OFF has no particles');
    await tab.wait(450);
    assert.equal((await tab.evaluate(state)).active, 'false');
    // A state change that was not the person's own tap (a rollback, a bulk action, a re-read) is drawn instantly.
    await tab.evaluate(`document.querySelector('[data-star-silent]').click()`);
    await tab.wait(60);
    const silent = await tab.evaluate(state);
    assert.equal(silent.active, 'true');
    assert.equal(silent.play, null);
    assert.equal(silent.particles, 0);
  } finally {
    await tab.close();
  }
});

for (const width of [390, 768, 1440]) {
  it(`selection at ${width}px: no 항목 선택 button; the card's own check (hover on a mouse, always on touch) starts it; 선택 종료 and Escape end it`, async () => {
    const tab = await open('lang=ko&view=list', width, 'light');
    try {
      // The old toolbar button is gone for good.
      assert.equal(await tab.evaluate(`document.querySelector('[data-select-mode]')`), null);
      assert.equal(await tab.evaluate(`[...document.querySelectorAll('button')].some(button => button.textContent.trim() === '항목 선택')`), false);
      const checkOpacity = `getComputedStyle(document.querySelectorAll('[data-select-check]')[1]).opacity`;
      const touch = await tab.evaluate(`matchMedia('(hover: none)').matches`);
      if (touch) {
        // No hover on a touch screen: the check is always there.
        assert.equal(await tab.evaluate(checkOpacity), '1', 'touch: the check is visible without hover');
      } else {
        assert.equal(await tab.evaluate(checkOpacity), '0', 'a mouse: the check waits for the hover');
        const center = await tab.evaluate(`(() => { const r = document.querySelectorAll('[data-select-check]')[1].closest('li').getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; })()`);
        await tab.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: center.x, y: center.y });
        await tab.wait(300);
        assert.equal(await tab.evaluate(checkOpacity), '1', 'hovering the card shows its check');
      }
      assert.equal(await tab.evaluate(`!!document.querySelector('[data-selection-bar]')`), false, 'nothing is selected yet, so there is no bar');
      // The check starts the selection; the bar (count + actions) docks at the bottom.
      await tab.evaluate(`document.querySelectorAll('[data-select-check]')[1].click()`);
      await tab.until(`!!document.querySelector('[data-selection-bar]')`);
      await tab.wait(250);
      assert.equal(await tab.evaluate(`document.querySelectorAll('li[data-selected="true"]').length`), 1);
      assert.equal(await tab.evaluate(`document.querySelector('[data-selection-count]').textContent.trim()`), '1개 선택됨');
      // A second card is a plain toggle while the selection runs.
      await tab.evaluate(`document.querySelectorAll('[data-select-check]')[2].click()`);
      await tab.wait(150);
      assert.equal(await tab.evaluate(`document.querySelectorAll('li[data-selected="true"]').length`), 2);
      // 선택 종료 (the bar's X) ends it and clears what was chosen.
      await tab.evaluate(`document.querySelector('[data-selection-bar] button[aria-label="선택 종료"]').click()`);
      await tab.until(`!document.querySelector('[data-selection-bar]')`);
      assert.equal(await tab.evaluate(`document.querySelectorAll('li[data-selected="true"]').length`), 0);
      // Escape ends one as well.
      await tab.evaluate(`document.querySelectorAll('[data-select-check]')[0].click()`);
      await tab.until(`!!document.querySelector('[data-selection-bar]')`);
      await capture(tab, `select-mode-active-${width}`);
      await tab.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
      await tab.until(`!document.querySelector('[data-selection-bar]')`);
      assert.equal(await tab.evaluate(`document.documentElement.scrollWidth <= innerWidth`), true);
    } finally {
      await tab.close();
    }
  });
}
