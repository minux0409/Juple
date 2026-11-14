// Local browser check of the polished Web screens: the REAL screens (sign-in card, Home, 보관함, Collections, a Collection, link details, 링크 저장,
// the new-Collection dialog, a running selection) in the real app shell on a stub API - never PROD or Azure DEV.
// Every scene is rendered at 360 / 390 / 768 / 1024 / 1440 / 1920 px in Light and Dark; screenshots go to POLISH_SCREENSHOT_DIR
// (default: the OS temp folder, juple-polish-shots).
// Run: node --test tests/browser/polish.browser.mjs        (POLISH_WIDTHS=390,1440 POLISH_SCENES=home to narrow it)
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, before, it } from 'node:test';
import { findChrome, openPage, closeAllPages } from './cdp.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const harness = `${root}app/polish-test-harness`;
const port = 3197;
const origin = `http://localhost:${port}`;
const shots = process.env.POLISH_SCREENSHOT_DIR ?? join(tmpdir(), 'juple-polish-shots');
const WIDTHS = (process.env.POLISH_WIDTHS ?? '360,390,768,1024,1440,1920').split(',').map(Number);
const THEMES = ['light', 'dark'];
let server;
let owned = false;

before(async () => {
  assert.ok(findChrome(), 'Chrome is required for this explicit browser test');
  assert.equal(existsSync(harness), false, 'Preserve any existing harness directory');
  mkdirSync(harness);
  owned = true;
  writeFileSync(`${harness}/page.tsx`, readFileSync(`${root}tests/browser/harness/polish.page.tsx.tpl`, 'utf8'));
  // The real shell, with only its route adapter replaced so the destination in the side bar follows ?at=.
  const shell = readFileSync(`${root}app/(app)/AppShell.tsx`, 'utf8')
    .replace("from 'next/navigation'", "from './navigationStub'")
    .replace(/from '\.\/(?!navigationStub)/g, "from '../(app)/");
  writeFileSync(`${harness}/AppShell.tsx`, shell);
  writeFileSync(`${harness}/navigationStub.ts`, "export const usePathname = () => (typeof window === 'undefined' ? '/' : (new URLSearchParams(window.location.search).get('at') ?? '/'));");
  server = spawn(process.execPath, [`${root}node_modules/next/dist/bin/next`, 'dev', '-p', String(port)], { cwd: root, stdio: 'ignore', env: { ...process.env, NEXT_TELEMETRY_DISABLED: '1' } });
  for (let attempt = 0; attempt < 240; attempt++) {
    try {
      if ((await fetch(`${origin}/polish-test-harness?scene=home`)).status === 200) return;
    } catch {
      /* local startup */
    }
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  throw new Error('Local server startup timeout');
});

after(async () => {
  await closeAllPages();
  if (owned) {
    rmSync(harness, { recursive: true, force: true });
    for (let attempt = 0; attempt < 30; attempt++) {
      const validator = `${root}.next/dev/types/validator.ts`;
      if (!existsSync(validator) || !readFileSync(validator, 'utf8').includes('polish-test-harness')) break;
      await new Promise(resolve => setTimeout(resolve, 300));
    }
  }
  if (server && process.platform === 'win32') {
    await new Promise(resolve => spawn('taskkill', ['/PID', String(server.pid), '/T', '/F'], { stdio: 'ignore' }).on('close', resolve));
  } else server?.kill();
});

let chromePort = 9800;
const READY = `document.readyState === 'complete' && !!document.querySelector('main, [data-sign-in]') && document.fonts.status === 'loaded'`;

/** Opens a scene in a fresh Chrome at the given width / theme and waits for the real content. */
async function open(scene, width, theme, { at = '/', lang = 'ko', waitFor } = {}) {
  const url = `${origin}/polish-test-harness?scene=${scene}&at=${encodeURIComponent(at)}&lang=${lang}`;
  const tab = await openPage(findChrome(), url, chromePort++);
  const errors = [];
  tab.onEvent(event => {
    if (event.method === 'Runtime.exceptionThrown') errors.push(event.params.exceptionDetails.text + ' ' + (event.params.exceptionDetails.exception?.description ?? '').slice(0, 240));
  });
  await tab.send('Runtime.enable');
  await tab.send('Emulation.setDeviceMetricsOverride', { width, height: width >= 1920 ? 1080 : width >= 1024 ? 900 : 844, deviceScaleFactor: 1, mobile: width < 600 });
  await tab.until(READY, 60_000);
  // The real theme path: the stored 화면 모드 preference, applied before paint by the bootstrap script.
  await tab.evaluate(`localStorage.setItem('juple.themePreference', '${theme}'); localStorage.setItem('juple.desktopSidebar', 'expanded')`);
  // The light theme is the default: without a marker the wait below could be satisfied by the OLD document, before the reload starts.
  await tab.evaluate('window.__beforeReload = true; setTimeout(() => location.reload(), 50); true');
  await tab.until(`window.__beforeReload === undefined && document.documentElement.dataset.theme === '${theme}' && ${READY}`, 60_000);
  if (waitFor) await tab.until(waitFor, 30_000);
  await tab.wait(700);
  return { tab, errors };
}

async function shot(tab, name) {
  mkdirSync(shots, { recursive: true });
  await tab.evaluate(`document.fonts.ready.then(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))`);
  const image = await tab.send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(join(shots, `${name}.png`), Buffer.from(image.result.data, 'base64'));
}

/** What every scene must satisfy: no sideways scroll, nothing wider than the window, no script error. */
async function generic(tab, errors, label) {
  const facts = await tab.evaluate(`(() => {
    const wide = [...document.querySelectorAll('body *')].filter(el => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && s.position !== 'fixed' && (r.right > innerWidth + 1 || r.left < -1) && !el.closest('[data-allow-overflow], dialog:not([open])') && getComputedStyle(el).visibility !== 'hidden'; }).slice(0, 4).map(el => el.tagName + '.' + String(el.className).slice(0, 50) + ' ' + Math.round(el.getBoundingClientRect().left) + '-' + Math.round(el.getBoundingClientRect().right));
    return { scrollWidth: document.documentElement.scrollWidth, innerWidth, wide };
  })()`);
  assert.ok(facts.scrollWidth <= facts.innerWidth, `${label}: horizontal page scroll (${facts.scrollWidth} > ${facts.innerWidth}) ${JSON.stringify(facts.wide)}`);
  assert.deepEqual(errors, [], `${label}: page errors`);
}

const click = (tab, selector) => tab.evaluate(`document.querySelector(${JSON.stringify(selector)}).click(); true`);
const clickText = (tab, text) => tab.evaluate(`[...document.querySelectorAll('button')].find(b => b.textContent.trim() === ${JSON.stringify(text)}).click(); true`);

const SCENES = [
  { name: 'landing', scene: 'landing', at: '/', ready: `!!document.querySelector('h2')` },
  { name: 'home', scene: 'home', at: '/', ready: `document.querySelectorAll('[data-select-check]').length >= 4` },
  { name: 'archive', scene: 'archive', at: '/archive', ready: `document.querySelectorAll('[data-select-check]').length >= 4` },
  { name: 'collections', scene: 'collections', at: '/collections', ready: `document.querySelectorAll('a[href^="/collections/"]').length >= 3` },
  { name: 'collection', scene: 'collection', at: '/collections', ready: `document.querySelectorAll('[data-select-check]').length >= 4` },
  { name: 'save', scene: 'save', at: '/', ready: `!!document.querySelector('[data-collection-create]')` },
  { name: 'detail', scene: 'detail', at: '/', ready: `!!document.querySelector('[data-item-detail] [data-detail-save]')` },
];

for (const spec of SCENES) {
  for (const theme of THEMES) {
    for (const width of WIDTHS) {
      if (process.env.POLISH_SCENES && !process.env.POLISH_SCENES.split(',').includes(spec.name)) continue;
      if (process.env.POLISH_ONLY_EDIT || process.env.POLISH_ONLY_REG || process.env.POLISH_ONLY_I18N) continue;
      it(`${spec.name} at ${width}px ${theme}`, async () => {
        const { tab, errors } = await open(spec.scene, width, theme, { at: spec.at, waitFor: spec.ready });
        try {
          await shot(tab, `${spec.name}-${width}-${theme}`);
          await generic(tab, errors, `${spec.name} ${width} ${theme}`);
          if (spec.name === 'detail') {
            // The docked foot stays inside the sheet and inside the window; the two actions never overlap.
            const foot = await tab.evaluate(`(() => { const f = document.querySelector('[data-item-detail] footer'); const b = [...f.querySelectorAll('button')].map(x => x.getBoundingClientRect()); const fr = f.getBoundingClientRect(); return { inside: b.every(r => r.bottom <= innerHeight && r.right <= innerWidth && r.left >= 0), overlap: b.length === 2 && !(b[0].right <= b[1].left || b[1].right <= b[0].left), heights: b.map(r => Math.round(r.height)), bottom: Math.round(fr.bottom), vh: innerHeight }; })()`);
            assert.equal(foot.inside, true, `detail ${width}: 삭제 / 저장 stay in the window`);
            assert.equal(foot.overlap, false, `detail ${width}: the buttons do not overlap`);
            assert.equal(new Set(foot.heights).size, 1, `detail ${width}: 삭제 and 저장 have the same height ${foot.heights}`);
          }
        } finally {
          await tab.close();
        }
      });
    }
  }
}

// ---- states ------------------------------------------------------------------------------------------------------------------

for (const theme of THEMES) {
  for (const width of WIDTHS) {
    if ((process.env.POLISH_SCENES && !process.env.POLISH_SCENES.includes('selection')) || process.env.POLISH_ONLY_EDIT || process.env.POLISH_ONLY_REG) continue;
    it(`선택 상태 + 하단 선택 바 at ${width}px ${theme}`, async () => {
      const { tab, errors } = await open('home', width, theme, { at: '/', waitFor: `document.querySelectorAll('[data-select-check]').length >= 4` });
      try {
        await tab.evaluate(`document.querySelectorAll('[data-select-check]')[1].click(); document.querySelectorAll('[data-select-check]')[2].click(); true`);
        await tab.until(`!!document.querySelector('[data-selection-bar]')`);
        await tab.wait(450);
        await shot(tab, `selection-${width}-${theme}`);
        await generic(tab, errors, `selection ${width} ${theme}`);
        const bar = await tab.evaluate(`(() => { const b = document.querySelector('[data-selection-bar]').getBoundingClientRect(); const items = [...document.querySelectorAll('[data-selection-bar] button')].map(x => { const r = x.getBoundingClientRect(); return [Math.round(r.left), Math.round(r.top), Math.round(r.right), Math.round(r.bottom), x.disabled]; }); return { left: Math.round(b.left), right: Math.round(b.right), bottom: Math.round(b.bottom), vw: innerWidth, vh: innerHeight, items, count: document.querySelector('[data-selection-count]').textContent.trim() }; })()`);
        assert.ok(bar.left >= 0 && bar.right <= bar.vw && bar.bottom <= bar.vh, `bar inside the window ${JSON.stringify(bar)}`);
        // No two bar buttons overlap each other.
        for (let i = 0; i < bar.items.length; i++) for (let j = i + 1; j < bar.items.length; j++) {
          const [a, b] = [bar.items[i], bar.items[j]];
          assert.ok(a[2] <= b[0] + 1 || b[2] <= a[0] + 1 || a[3] <= b[1] + 1 || b[3] <= a[1] + 1, `selection bar buttons ${i} and ${j} overlap`);
        }
        assert.equal(bar.count, '2개 선택됨');
      } finally {
        await tab.close();
      }
    });
  }
}

for (const theme of THEMES) {
  for (const width of WIDTHS) {
    if ((process.env.POLISH_SCENES && !process.env.POLISH_SCENES.includes('newcollection')) || process.env.POLISH_ONLY_EDIT || process.env.POLISH_ONLY_REG) continue;
    it(`새 컬렉션 모달 at ${width}px ${theme}: reachable footer, scrolls to the colors, live preview`, async () => {
      const { tab, errors } = await open('save', width, theme, { at: '/', waitFor: `!!document.querySelector('[data-collection-create]')` });
      try {
        await tab.wait(1500);
        await click(tab, '[data-collection-create]');
        await tab.until(`!!document.querySelector('dialog[open] [data-collection-preview]')`);
        await tab.wait(500);
        await shot(tab, `newcollection-${width}-${theme}-1-open`);
        const facts = await tab.evaluate(`(() => {
          const dialog = document.querySelector('dialog[open]');
          const d = dialog.getBoundingClientRect();
          const foot = [...dialog.querySelectorAll('button[type=submit], button')].filter(b => ['취소', '만들기'].includes(b.textContent.trim()));
          const scroller = [...dialog.querySelectorAll('*')].find(el => el.scrollHeight > el.clientHeight + 4 && ['auto', 'scroll'].includes(getComputedStyle(el).overflowY));
          const create = foot.find(b => b.textContent.trim() === '만들기');
          const grid = dialog.querySelector('[role=radiogroup]');
          const preview = dialog.querySelector('[data-collection-preview]').getBoundingClientRect();
          const g = grid.getBoundingClientRect();
          const cs = getComputedStyle(create);
          return {
            dialog: [Math.round(d.left), Math.round(d.top), Math.round(d.right), Math.round(d.bottom)],
            vw: innerWidth, vh: innerHeight,
            footVisible: foot.length === 2 && foot.every(b => { const r = b.getBoundingClientRect(); return r.top >= d.top && r.bottom <= d.bottom + 1 && r.right <= innerWidth && r.left >= 0; }),
            scrollable: !!scroller,
            createBg: cs.backgroundColor, createColor: cs.color, createDisabled: create.disabled,
            gap: Math.round(g.top - preview.bottom),
            iconSizes: [...new Set([...grid.querySelectorAll('[role=radio]')].map(b => Math.round(b.getBoundingClientRect().width) + 'x' + Math.round(b.getBoundingClientRect().height)))],
          };
        })()`);
        assert.ok(facts.dialog[0] >= 0 && facts.dialog[2] <= facts.vw && facts.dialog[3] <= facts.vh + 1, `dialog inside the window ${JSON.stringify(facts)}`);
        assert.equal(facts.footVisible, true, `취소 / 만들기 are visible inside the dialog ${JSON.stringify(facts)}`);
        assert.notEqual(facts.createBg, 'rgba(0, 0, 0, 0)', '만들기 has a real background (was transparent)');
        assert.notEqual(facts.createBg, facts.createColor, '만들기 text differs from its background');
        assert.ok(facts.gap >= 12, `space between the preview and the icon grid (${facts.gap}px)`);
        assert.equal(facts.iconSizes.length, 1, `every icon card has the same size ${facts.iconSizes}`);
        // The body scrolls to the very end (colors reachable, not clipped).
        await tab.evaluate(`(() => { const dialog = document.querySelector('dialog[open]'); const s = [...dialog.querySelectorAll('*')].find(el => el.scrollHeight > el.clientHeight + 4 && ['auto', 'scroll'].includes(getComputedStyle(el).overflowY)); if (s) s.scrollTop = s.scrollHeight; return true; })()`);
        await tab.wait(300);
        await shot(tab, `newcollection-${width}-${theme}-2-colors`);
        const colors = await tab.evaluate(`(() => { const dialog = document.querySelector('dialog[open]'); const hue = dialog.querySelector('input[type=range]').getBoundingClientRect(); const sw = [...dialog.querySelectorAll('[role=radiogroup]')][1].querySelectorAll('[role=radio]'); const last = sw[sw.length - 1].getBoundingClientRect(); const foot = [...dialog.querySelectorAll('button')].find(b => b.textContent.trim() === '만들기').getBoundingClientRect(); return { hueBottom: Math.round(hue.bottom), lastBottom: Math.round(last.bottom), footTop: Math.round(foot.top), n: sw.length }; })()`);
        assert.ok(colors.hueBottom <= colors.footTop + 1 && colors.lastBottom <= colors.footTop + 1, `the colors are not clipped behind the footer ${JSON.stringify(colors)}`);
        await generic(tab, errors, `newcollection ${width} ${theme}`);
      } finally {
        await tab.close();
      }
    });
  }
}

// ---- 링크 상세 편집: the exact requests the details send (stub API; every write is recorded) ----------------------------------

const writesOf = async tab => (await tab.evaluate(`sessionStorage.getItem('writes') ?? '[]'`)).length ? JSON.parse(await tab.evaluate(`sessionStorage.getItem('writes') ?? '[]'`)).map(entry => JSON.parse(entry)) : [];
const changesOf = async tab => JSON.parse(await tab.evaluate(`sessionStorage.getItem('changes') ?? '[]'`)).map(entry => JSON.parse(entry));
const typeInto = (selector, text) =>
  `(() => { const field = document.querySelector(${JSON.stringify(selector)}); const proto = field instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(proto, 'value').set.call(field, ${JSON.stringify(text)}); field.dispatchEvent(new Event('input', { bubbles: true })); true; })()`;
const TITLE = `input[class*="itemEd"], input[class*="detailTitleInput"]`;
const MEMO = `[data-item-detail] textarea`;
const ORIGINAL_TITLE = '작은 습관이 인생을 바꾸는 방법';

async function openDetail(extraQuery = '') {
  const url = `${origin}/polish-test-harness?scene=detail&at=%2F&lang=ko${extraQuery}`;
  const tab = await openPage(findChrome(), url, chromePort++);
  await tab.send('Runtime.enable');
  await tab.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
  await tab.until(`!!document.querySelector('[data-item-detail] [data-detail-save]')`, 60_000);
  await tab.wait(800);
  await tab.evaluate(`sessionStorage.removeItem('writes'); sessionStorage.removeItem('changes'); true`);
  return tab;
}
const saveButton = `document.querySelector('[data-detail-save]')`;
const dialogButton = (text, last = false) => `(() => { const list = [...document.querySelectorAll('dialog[open] button')].filter(b => b.textContent.trim() === ${JSON.stringify(text)}); return list[${last ? 'list.length - 1' : 0}]; })()`;

it('링크 상세 저장 계약: title + memo are ONE PUT /api/v1/items/7/details with both fields as typed; nothing else is sent; the lists hear it', async () => {
  const tab = await openDetail();
  try {
    assert.equal(await tab.evaluate(`${saveButton}.disabled`), true, 'unchanged: 저장 is asleep');
    await tab.evaluate(typeInto(TITLE, '  새 제목  '));
    await tab.evaluate(typeInto(MEMO, '새 메모\n둘째 줄'));
    await tab.wait(150);
    assert.equal(await tab.evaluate(`${saveButton}.disabled`), false);
    await tab.evaluate(`${saveButton}.click(); true`);
    await tab.until(`!document.querySelector('[data-item-detail]')`, 15_000);
    assert.deepEqual(await writesOf(tab), [{ method: 'PUT', path: '/api/v1/items/7/details', body: { title: '  새 제목  ', memo: '새 메모\n둘째 줄' } }], 'exactly the Backend UpdateItemDetailsRequest(Title, Memo) - the server normalizes');
    assert.ok((await changesOf(tab)).some(change => change.kind === 'updated' && change.itemId === 7), 'the lists under the sheet are told the link changed');
  } finally { await tab.close(); }
});

it('링크 상세 저장 계약: changing only the memo still sends the unchanged title next to it (the endpoint replaces both)', async () => {
  const tab = await openDetail();
  try {
    await tab.evaluate(typeInto(MEMO, '메모만 변경'));
    await tab.evaluate(`${saveButton}.click(); true`);
    await tab.until(`!document.querySelector('[data-item-detail]')`, 15_000);
    assert.deepEqual(await writesOf(tab), [{ method: 'PUT', path: '/api/v1/items/7/details', body: { title: ORIGINAL_TITLE, memo: '메모만 변경' } }]);
  } finally { await tab.close(); }
});

it('링크 상세 저장 실패: the typed title / memo stay, the error is said, the sheet stays open and 저장 can be pressed again', async () => {
  const tab = await openDetail('&fail=details');
  try {
    await tab.evaluate(typeInto(TITLE, '실패해도 남아야 하는 제목'));
    await tab.evaluate(typeInto(MEMO, '실패해도 남아야 하는 메모'));
    await tab.evaluate(`${saveButton}.click(); true`);
    await tab.until(`!!document.querySelector('[data-item-detail] [role=alert]')`, 15_000);
    await tab.wait(300);
    const state = await tab.evaluate(`({ title: document.querySelector('${TITLE}').value, memo: document.querySelector('${MEMO}').value, open: !!document.querySelector('[data-item-detail]'), saveDisabled: ${saveButton}.disabled, alert: document.querySelector('[data-item-detail] [role=alert]').textContent.trim() })`);
    assert.equal(state.title, '실패해도 남아야 하는 제목');
    assert.equal(state.memo, '실패해도 남아야 하는 메모');
    assert.equal(state.open, true);
    assert.equal(state.saveDisabled, false, 'still dirty: retry is possible');
    assert.ok(state.alert.length > 0);
    assert.deepEqual((await changesOf(tab)).filter(change => change.kind === 'updated'), [], 'a failed save tells the lists nothing');
  } finally { await tab.close(); }
});

it('링크 상세 사진: the file goes up at once as multipart "file" to /items/7/images and is NOT part of 저장', async () => {
  const tab = await openDetail();
  try {
    await tab.evaluate(`(() => { const input = document.querySelector('[data-item-detail] input[type=file]'); const data = new DataTransfer(); data.items.add(new File([new Uint8Array(64)], 'cover.png', { type: 'image/png' })); input.files = data.files; input.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
    await tab.until(`document.querySelector('[data-item-detail] [data-photo-editor]')?.dataset.photoEditor === 'photo'`, 15_000);
    const writes = await writesOf(tab);
    assert.equal(writes.length, 1);
    assert.equal(writes[0].method, 'POST');
    assert.equal(writes[0].path, '/api/v1/items/7/images');
    assert.deepEqual(writes[0].body.form.file, { name: 'cover.png', type: 'image/png', size: 64 });
    assert.equal(await tab.evaluate(`${saveButton}.disabled`), true, 'a photo change is immediate: 저장 stays asleep');
  } finally { await tab.close(); }
});

it('링크 상세 컬렉션: the pencil opens the picker; the change is staged and saved as adds first, then removals (PUT / DELETE .../items/7)', async () => {
  const tab = await openDetail();
  try {
    await tab.until(`!document.querySelector('[data-edit-collections]').disabled`, 15_000);
    await click(tab, '[data-edit-collections]');
    await tab.until(`!!document.querySelector('dialog[open] [aria-pressed]') && [...document.querySelectorAll('dialog[open] button')].some(b => b.textContent.includes('Design inspiration'))`, 20_000);
    await tab.wait(400);
    await shot(tab, 'detail-collections-dialog-light');
    assert.deepEqual(await writesOf(tab), [], 'opening the picker sends nothing');
    // Take the link out of 웹툰 (10), put it into Design inspiration (12).
    await tab.evaluate(`[...document.querySelectorAll('dialog[open] button')].find(b => b.textContent.includes('웹툰')).click(); true`);
    await tab.wait(200);
    await tab.evaluate(`[...document.querySelectorAll('dialog[open] button')].find(b => b.textContent.includes('Design inspiration')).click(); true`);
    await tab.wait(300);
    assert.deepEqual(await writesOf(tab), [], 'choosing in the picker is only staging');
    await tab.evaluate(`${dialogButton('확인')}.click(); true`);
    await tab.wait(300);
    assert.equal(await tab.evaluate(`${saveButton}.disabled`), false, 'a staged Collection change wakes 저장 up');
    const chips = await tab.evaluate(`[...document.querySelectorAll('[data-item-detail] a[href^="/collections/"]')].map(a => a.textContent.trim())`);
    assert.deepEqual(chips, ['Design inspiration'], 'the row shows what will be saved');
    await tab.evaluate(`${saveButton}.click(); true`);
    await tab.until(`!document.querySelector('[data-item-detail]')`, 15_000);
    assert.deepEqual((await writesOf(tab)).map(entry => `${entry.method} ${entry.path}`), ['PUT /api/v1/collections/12/items/7', 'DELETE /api/v1/collections/10/items/7']);
  } finally { await tab.close(); }
});

it('링크 상세 권한: a Collection where I am only a contributor cannot be left from here (the Owner alone takes links out)', async () => {
  const tab = await openDetail('&m=2');
  try {
    await tab.until(`!document.querySelector('[data-edit-collections]').disabled`, 15_000);
    await click(tab, '[data-edit-collections]');
    await tab.until(`[...document.querySelectorAll('dialog[open] button')].some(b => b.textContent.includes('Shared by Mina'))`, 20_000);
    await tab.wait(400);
    const before = await tab.evaluate(`[...document.querySelectorAll('dialog[open] button')].find(b => b.textContent.includes('Shared by Mina')).getAttribute('aria-pressed')`);
    await tab.evaluate(`[...document.querySelectorAll('dialog[open] button')].find(b => b.textContent.includes('Shared by Mina')).click(); true`);
    await tab.wait(400);
    const after = await tab.evaluate(`[...document.querySelectorAll('dialog[open] button')].find(b => b.textContent.includes('Shared by Mina')).getAttribute('aria-pressed')`);
    assert.equal(before, 'true');
    assert.equal(after, 'true', 'still chosen: removing it is the Owner\'s');
    await tab.evaluate(`${dialogButton('확인')}.click(); true`);
    await tab.wait(300);
    assert.equal(await tab.evaluate(`${saveButton}.disabled`), true, 'nothing changed, nothing to save');
    assert.deepEqual(await writesOf(tab), []);
  } finally { await tab.close(); }
});

it('링크 상세 삭제: it asks first; confirming sends DELETE /api/v1/items/7 (the trash path, never /permanent)', async () => {
  const tab = await openDetail();
  try {
    await tab.evaluate(`[...document.querySelectorAll('[data-item-detail] footer button')][0].click(); true`);
    await tab.until(`!!document.querySelector('dialog[open] [role], dialog[open]') && [...document.querySelectorAll('dialog[open]')].some(d => d.textContent.includes('링크를 삭제할까요?'))`);
    assert.deepEqual(await writesOf(tab), [], 'the button only asks');
    await tab.evaluate(`${dialogButton('삭제', true)}.click(); true`);
    await tab.until(`!document.querySelector('[data-item-detail]')`, 15_000);
    assert.deepEqual(await writesOf(tab), [{ method: 'DELETE', path: '/api/v1/items/7' }]);
    assert.ok((await changesOf(tab)).some(change => change.kind === 'deleted' && change.itemId === 7));
  } finally { await tab.close(); }
});

it('링크 상세 닫기: unsaved edits ask first; 계속 편집 keeps everything typed and sends nothing', async () => {
  const tab = await openDetail();
  try {
    await tab.evaluate(typeInto(TITLE, '입력 중인 제목'));
    await tab.evaluate(typeInto(MEMO, '입력 중인 메모'));
    await tab.wait(200);
    await click(tab, 'dialog[open] header button');
    await tab.until(`[...document.querySelectorAll('dialog[open]')].some(d => d.textContent.includes('저장하지 않은 변경'))`);
    await shot(tab, 'detail-leave-confirm-light');
    await tab.evaluate(`${dialogButton('계속 편집')}.click(); true`);
    await tab.wait(400);
    const state = await tab.evaluate(`({ title: document.querySelector('${TITLE}').value, memo: document.querySelector('${MEMO}').value, open: !!document.querySelector('[data-item-detail]'), saveDisabled: ${saveButton}.disabled })`);
    assert.deepEqual(state, { title: '입력 중인 제목', memo: '입력 중인 메모', open: true, saveDisabled: false });
    assert.deepEqual(await writesOf(tab), []);
    // Typing the originals back makes the details clean again: no question, nothing to save.
    await tab.evaluate(typeInto(TITLE, ORIGINAL_TITLE));
    await tab.evaluate(typeInto(MEMO, '유튜브에서 보려고 저장'));
    await tab.wait(200);
    assert.equal(await tab.evaluate(`${saveButton}.disabled`), true);
  } finally { await tab.close(); }
});

// ---- 새 컬렉션: what is chosen is what is sent ----------------------------------------------------------------------------------

async function openNewCollection(width = 1280) {
  const url = `${origin}/polish-test-harness?scene=save&at=%2F&lang=ko`;
  const tab = await openPage(findChrome(), url, chromePort++);
  await tab.send('Runtime.enable');
  await tab.send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: width < 600 });
  await tab.until(`!!document.querySelector('[data-collection-create]')`, 60_000);
  await tab.wait(2500);
  await tab.evaluate(`sessionStorage.removeItem('writes'); true`);
  await click(tab, '[data-collection-create]');
  await tab.until(`!!document.querySelector('dialog[open] [data-collection-preview]')`);
  await tab.wait(500);
  return tab;
}
const previewFacts = `(() => {
  const dialog = document.querySelector('dialog[open]');
  const tile = dialog.querySelector('[data-collection-preview] > div');
  const selectedIcon = dialog.querySelectorAll('[role=radiogroup]')[0].querySelector('[aria-checked=true]');
  const selectedSwatch = dialog.querySelectorAll('[role=radiogroup]')[1].querySelector('[aria-checked=true]');
  return { tileBg: getComputedStyle(tile).backgroundColor, tileColor: getComputedStyle(tile).color, icon: selectedIcon.getAttribute('aria-label'), iconBorder: getComputedStyle(selectedIcon).borderTopColor, iconBg: getComputedStyle(selectedIcon).backgroundColor, swatch: selectedSwatch ? selectedSwatch.getAttribute('aria-label') : null, previewImg: !!tile.querySelector('img'), name: dialog.querySelector('[data-collection-preview] p').textContent.trim() };
})()`;

it('새 컬렉션: the chosen icon / color / name show in the preview at once and POST /api/v1/collections sends exactly them', async () => {
  const tab = await openNewCollection();
  try {
    const start = await tab.evaluate(previewFacts);
    assert.equal(start.icon, 'Folder');
    assert.equal(start.swatch, 'Blue');
    // Pick the 6th icon and the 4th color.
    await tab.evaluate(`document.querySelectorAll('dialog[open] [role=radiogroup]')[0].querySelectorAll('[role=radio]')[5].click(); true`);
    await tab.evaluate(`document.querySelectorAll('dialog[open] [role=radiogroup]')[1].querySelectorAll('[role=radio]')[3].click(); true`);
    await tab.evaluate(typeInto('dialog[open] input[type=text], dialog[open] input:not([type])', '  여름 휴가 계획  '));
    await tab.wait(400);
    const chosen = await tab.evaluate(previewFacts);
    const expectedIcon = await tab.evaluate(`document.querySelectorAll('dialog[open] [role=radiogroup]')[0].querySelectorAll('[role=radio]')[5].getAttribute('aria-label')`);
    assert.equal(chosen.icon, expectedIcon, 'the chosen icon is the selected card');
    assert.equal(chosen.swatch, 'Amber', 'the 4th color is Amber');
    assert.notEqual(chosen.tileBg, start.tileBg, 'the preview tile took the new color at once');
    assert.equal(chosen.iconBg, chosen.tileBg, 'the selected icon card shows the same chosen color');
    assert.equal(chosen.name, '여름 휴가 계획');
    await shot(tab, 'newcollection-chosen-light');
    await tab.evaluate(`${dialogButton('만들기')}.click(); true`);
    await tab.until(`!document.querySelector('dialog[open] [data-collection-preview]')`, 15_000);
    const writes = await writesOf(tab);
    assert.deepEqual(writes, [{ method: 'POST', path: '/api/v1/collections', body: { name: '여름 휴가 계획', icon: expectedIcon, color: 'Amber' } }], 'Backend CreateCollectionRequest(Name, Icon, Color): name trimmed, the chosen icon and color key');
  } finally { await tab.close(); }
});

it('새 컬렉션: a picked photo replaces the preview and goes up as multipart "file" to .../icon-image only AFTER the Collection exists; an empty name sends nothing', async () => {
  const tab = await openNewCollection();
  try {
    await tab.evaluate(`${dialogButton('만들기')}.click(); true`);
    await tab.wait(500);
    assert.deepEqual(await writesOf(tab), [], 'no name: nothing is sent');
    assert.equal(await tab.evaluate(`!!document.querySelector('dialog[open] [role=alert]')`), true, 'the name error is shown');
    await tab.evaluate(`(() => { const input = document.querySelector('dialog[open] input[type=file]'); const data = new DataTransfer(); data.items.add(new File([new Uint8Array(48)], 'icon.png', { type: 'image/png' })); input.files = data.files; input.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
    await tab.until(`!!document.querySelector('dialog[open] [data-collection-preview] img')`);
    await tab.evaluate(typeInto('dialog[open] input[type=text], dialog[open] input:not([type])', '사진 컬렉션'));
    await shot(tab, 'newcollection-photo-light');
    await tab.evaluate(`${dialogButton('만들기')}.click(); true`);
    await tab.until(`!document.querySelector('dialog[open] [data-collection-preview]')`, 15_000);
    const writes = await writesOf(tab);
    assert.deepEqual(writes.map(entry => `${entry.method} ${entry.path}`), ['POST /api/v1/collections', 'PUT /api/v1/collections/99/icon-image']);
    assert.deepEqual(writes[1].body.form.file, { name: 'icon.png', type: 'image/png', size: 48 });
  } finally { await tab.close(); }
});

// ---- 선택 회귀: Home, 보관함, a Collection, the Collections list ---------------------------------------------------------------

const CARD = n => `document.querySelectorAll('[data-select-check]')[${n}].closest('li')`;
async function openSelectable(scene, at, ready) {
  const url = `${origin}/polish-test-harness?scene=${scene}&at=${encodeURIComponent(at)}&lang=ko`;
  const tab = await openPage(findChrome(), url, chromePort++);
  await tab.send('Runtime.enable');
  await tab.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
  await tab.until(ready, 60_000);
  await tab.wait(1200);
  await tab.evaluate(`sessionStorage.removeItem('writes'); true`);
  return tab;
}
const barUp = `!!document.querySelector('[data-selection-bar]')`;
const barDown = `!document.querySelector('[data-selection-bar]')`;

for (const [name, scene, at, ready] of [
  ['Home', 'home', '/', `document.querySelectorAll('[data-select-check]').length >= 4`],
  ['보관함', 'archive', '/archive', `document.querySelectorAll('[data-select-check]').length >= 4`],
  ['컬렉션 상세', 'collection', '/collections', `document.querySelectorAll('[data-select-check]').length >= 4`],
  ['컬렉션 목록', 'collections', '/collections', `document.querySelectorAll('[data-select-check]').length >= 2`],
]) {
  it(`선택 회귀 (${name}): hover shows the check; the check starts it; a card click adds; un-checking the last ends it; Esc ends; Ctrl-click still opens; the star / ⋯ do not select`, async () => {
    const tab = await openSelectable(scene, at, ready);
    try {
      if (scene === 'collections') {
        // The list opens on 즐겨찾기 (two cards): 전체 has them all.
        await clickText(tab, '전체');
        await tab.until(`document.querySelectorAll('[data-select-check]').length >= 4`, 15_000);
        await tab.wait(500);
      }
      const opacity = n => tab.evaluate(`getComputedStyle(document.querySelectorAll('[data-select-check]')[${n}]).opacity`);
      assert.equal(await opacity(1), '0', 'a mouse: no check until hover');
      const center = await tab.evaluate(`(() => { const r = ${CARD(1)}.getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; })()`);
      await tab.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: center.x, y: center.y });
      await tab.wait(350);
      assert.equal(await opacity(1), '1', 'hover shows the check');
      // Ctrl-click on the card opens it as before (the click is NOT taken by the selection) - nothing is selected.
      const ctrl = await tab.evaluate(`(() => { const a = ${CARD(1)}.querySelector('a[href]:not([data-link-open])'); if (!a) return 'no-link'; const event = new MouseEvent('click', { bubbles: true, cancelable: true, ctrlKey: true }); a.addEventListener('click', e => e.preventDefault(), { once: true }); a.dispatchEvent(event); return 'ok'; })()`);
      await tab.wait(200);
      assert.notEqual(ctrl, 'no-link');
      assert.equal(await tab.evaluate(barUp), false, 'Ctrl-click does not start a selection');
      // The check starts a selection.
      await tab.evaluate(`document.querySelectorAll('[data-select-check]')[1].click(); true`);
      await tab.until(barUp);
      assert.equal(await tab.evaluate(`document.querySelector('[data-selection-count]').textContent.trim()`), '1개 선택됨');
      // While it runs, a click on another card's body toggles it (no navigation).
      const here = await tab.evaluate(`location.pathname + location.search`);
      await tab.evaluate(`${CARD(2)}.querySelector('a[href]:not([data-link-open]), div[aria-disabled]').click(); true`);
      await tab.wait(300);
      assert.equal(await tab.evaluate(`document.querySelector('[data-selection-count]').textContent.trim()`), '2개 선택됨');
      assert.equal(await tab.evaluate(`location.pathname + location.search`), here, 'a click while selecting never navigates');
      // The star / the open-original button on a card are not taken by the selection.
      const sideEffects = await tab.evaluate(`(() => { const li = ${CARD(0)}; const star = li.querySelector('[data-star-button], [aria-label*="즐겨찾기"]'); const open = li.querySelector('[data-link-open]'); return { star: !!star, open: !!open }; })()`);
      assert.ok(sideEffects.star || sideEffects.open || name === 'Home' || name === '보관함', 'card actions exist');
      // Un-check both: the selection ends by itself and the bar goes.
      await tab.evaluate(`document.querySelectorAll('[data-select-check]')[1].click(); document.querySelectorAll('[data-select-check]')[2].click(); true`);
      await tab.until(barDown, 10_000);
      assert.equal(await tab.evaluate(barUp), false, 'the last un-check ends the selection');
      // Esc ends a running one.
      await tab.evaluate(`document.querySelectorAll('[data-select-check]')[0].click(); true`);
      await tab.until(barUp);
      await tab.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
      await tab.until(barDown, 10_000);
      assert.deepEqual(await writesOf(tab), [], 'selecting alone sends nothing');
    } finally { await tab.close(); }
  });
}

it('선택 기능 (Home): 삭제 asks first and sends one DELETE /api/v1/items/{id} per chosen link; 컬렉션에 추가 sends one replicate per link; the bar closes after', async () => {
  const tab = await openSelectable('home', '/', `document.querySelectorAll('[data-select-check]').length >= 4`);
  try {
    await tab.evaluate(`document.querySelectorAll('[data-select-check]')[1].click(); document.querySelectorAll('[data-select-check]')[2].click(); true`);
    await tab.until(barUp);
    await click(tab, '[data-selection-action="delete"]');
    await tab.until(`[...document.querySelectorAll('dialog[open]')].some(d => d.textContent.includes('삭제'))`);
    assert.deepEqual(await writesOf(tab), [], 'the bar only asks');
    await tab.evaluate(`${dialogButton('삭제', true)}.click(); true`);
    await tab.until(`!document.querySelector('dialog[open]')`, 15_000);
    await tab.wait(500);
    assert.deepEqual((await writesOf(tab)).map(entry => `${entry.method} ${entry.path}`).sort(), ['DELETE /api/v1/items/2', 'DELETE /api/v1/items/3']);
  } finally { await tab.close(); }
});

it('선택 기능 (컬렉션 상세): 컬렉션에서 제거 sends one DELETE /api/v1/collections/10/items/{id} per chosen link (never the link itself)', async () => {
  const tab = await openSelectable('collection', '/collections', `document.querySelectorAll('[data-select-check]').length >= 4`);
  try {
    await tab.evaluate(`document.querySelectorAll('[data-select-check]')[0].click(); document.querySelectorAll('[data-select-check]')[1].click(); true`);
    await tab.until(barUp);
    await click(tab, '[data-selection-action="remove"]');
    await tab.until(`[...document.querySelectorAll('dialog[open]')].length > 0`);
    await tab.evaluate(`${dialogButton('삭제', true)}.click(); true`);
    await tab.until(`!document.querySelector('dialog[open]')`, 15_000);
    await tab.wait(500);
    assert.deepEqual((await writesOf(tab)).map(entry => `${entry.method} ${entry.path}`).sort(), ['DELETE /api/v1/collections/10/items/1', 'DELETE /api/v1/collections/10/items/2']);
  } finally { await tab.close(); }
});

// ---- 일괄 작업 · 카드 액션 충돌 · 확인창 닫기 (stub API; every write is recorded) --------------------------------------------------

async function openScene(scene, extra, ready, width = 1280) {
  const url = `${origin}/polish-test-harness?scene=${scene}&at=%2F&lang=ko${extra}`;
  const tab = await openPage(findChrome(), url, chromePort++);
  await tab.send('Runtime.enable');
  await tab.send('Browser.grantPermissions', { permissions: ['clipboardReadWrite', 'clipboardSanitizedWrite'] }).catch(() => undefined);
  await tab.send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: width < 600 });
  await tab.until(ready, 60_000);
  await tab.wait(1200);
  await tab.evaluate(`sessionStorage.removeItem('writes'); true`);
  return tab;
}
const selectedCount = `document.querySelectorAll('li[data-selected="true"]').length`;
const countText = `document.querySelector('[data-selection-count]')?.textContent.trim() ?? ''`;
const actionsOf = tab => tab.evaluate(`[...document.querySelectorAll('[data-selection-action]')].map(b => b.dataset.selectionAction + (b.disabled ? ':disabled' : ''))`);
const pick = (tab, indexes) => tab.evaluate(`${JSON.stringify(indexes)}.forEach(i => document.querySelectorAll('[data-select-check]')[i].click()); true`);
const READY4 = `document.querySelectorAll('[data-select-check]').length >= 4`;
const confirmOpen = `[...document.querySelectorAll('dialog[open]')].length > 0`;
/** A click on the dimmed area outside the open dialog (its backdrop) - what a person does to "click away". */
const clickBackdrop = tab => tab.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: 3, y: 3, button: 'left', clickCount: 1 }).then(() => tab.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 3, y: 3, button: 'left', clickCount: 1 }));
const pressEscape = tab => tab.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });

it('카드 액션 충돌: the favorite star, 공유 / 수정 links and 링크 열기 never change the selection - before, during or after it', async () => {
  const tab = await openScene('collections', '', `document.querySelectorAll('a[href^="/collections/"]').length >= 3`);
  try {
    await clickText(tab, '전체');
    await tab.until(READY4, 15_000);
    await tab.wait(400);
    const star = i => `document.querySelectorAll('[data-select-check]')[${i}].closest('li').querySelector('button[class*="cardAction"]')`;
    // Not selecting: the star toggles the favorite and does NOT start a selection.
    await tab.evaluate(`${star(2)}.click(); true`);
    await tab.wait(400);
    assert.equal(await tab.evaluate(barUp), false, 'the star does not start a selection');
    assert.deepEqual((await writesOf(tab)).map(entry => `${entry.method} ${entry.path}`), ['PUT /api/v1/collections/12/favorite'], 'the star is a favorite toggle');
    // Selecting: the star of ANOTHER card changes the favorite but not the selection.
    await tab.evaluate(`document.querySelectorAll('[data-select-check]')[0].click(); true`);
    await tab.until(barUp);
    assert.equal(await tab.evaluate(countText), '1개 선택됨');
    await tab.evaluate(`${star(3)}.click(); true`);
    await tab.wait(400);
    assert.equal(await tab.evaluate(countText), '1개 선택됨', 'the star did not toggle the selection');
    assert.equal(await tab.evaluate(selectedCount), 1);
    // The card's own share / edit links are real links: a click on them is not taken by the selection either.
    const links = await tab.evaluate(`(() => { const li = document.querySelectorAll('[data-select-check]')[2].closest('li'); const a = li.querySelector('a[data-card-action]'); if (!a) return 'none'; a.addEventListener('click', e => e.preventDefault(), { once: true }); a.click(); return 'clicked'; })()`);
    await tab.wait(300);
    assert.notEqual(links, 'clicked-and-selected');
    assert.equal(await tab.evaluate(countText), '1개 선택됨', 'a card action link did not toggle the selection');
  } finally { await tab.close(); }
});

it('카드 액션 충돌 (Home): 링크 열기 never starts or changes a selection', async () => {
  const tab = await openScene('home', '', READY4);
  try {
    const open = `document.querySelectorAll('[data-link-open]')`;
    await tab.evaluate(`(() => { const a = ${open}[2]; a.addEventListener('click', e => e.preventDefault(), { once: true }); a.click(); return true; })()`);
    await tab.wait(300);
    assert.equal(await tab.evaluate(barUp), false, 'not selecting: 링크 열기 only opens the link');
    await pick(tab, [0]);
    await tab.until(barUp);
    await tab.evaluate(`(() => { const a = ${open}[3]; a.addEventListener('click', e => e.preventDefault(), { once: true }); a.click(); return true; })()`);
    await tab.wait(300);
    assert.equal(await tab.evaluate(countText), '1개 선택됨', 'selecting: 링크 열기 did not toggle the card');
    assert.ok((await writesOf(tab)).every(entry => entry.method === 'POST' && /^\/api\/v1\/items\/\d+\/open$/.test(entry.path)), 'only the best-effort note for 최근 조회한 링크 may be sent, never a change of a link');
  } finally { await tab.close(); }
});

it('일괄 (Home): 컬렉션에 추가 = one replicate per link into the chosen Collection; 링크 복사 says how many; nothing is removed', async () => {
  const tab = await openScene('home', '', READY4);
  try {
    await pick(tab, [1, 2]);
    await tab.until(barUp);
    assert.deepEqual(await actionsOf(tab), ['add', 'copy', 'delete']);
    // 링크 복사: the addresses as one text; the toast says how many (or that it could not).
    await click(tab, '[data-selection-action="copy"]');
    await tab.until(`document.body.textContent.includes('링크 2개를 복사했어요') || document.body.textContent.includes('복사')`, 10_000);
    assert.deepEqual(await writesOf(tab), [], 'copying writes nothing');
    await click(tab, '[data-selection-action="add"]');
    await tab.until(`!!document.querySelector('dialog[open] [aria-pressed]')`, 20_000);
    await tab.wait(400);
    await tab.evaluate(`[...document.querySelectorAll('dialog[open] button')].find(b => b.textContent.includes('웹툰')).click(); true`);
    await tab.wait(200);
    await click(tab, '[data-destination-submit]');
    await tab.until(`!document.querySelector('dialog[open]')`, 15_000);
    await tab.wait(500);
    const writes = await writesOf(tab);
    assert.equal(writes.length, 2, 'one request per link');
    for (const entry of writes) {
      assert.equal(entry.method, 'POST');
      assert.match(entry.path, /^\/api\/v1\/items\/[23]\/collections$/);
      assert.deepEqual(entry.body.collectionIds, [10]);
    }
    assert.equal(await tab.evaluate(barDown), true, 'the bar closes after a fully successful add');
  } finally { await tab.close(); }
});

it('일괄 (Home) 삭제: a partial failure keeps ONLY the failed link selected and says so; clicking away or Esc on the question writes nothing', async () => {
  const tab = await openScene('home', '&failOn=items%2F3', READY4);
  try {
    await pick(tab, [1, 2]);
    await tab.until(barUp);
    // Esc and a click on the backdrop only close the question.
    await click(tab, '[data-selection-action="delete"]');
    await tab.until(confirmOpen);
    await pressEscape(tab);
    await tab.wait(300);
    assert.equal(await tab.evaluate(`document.querySelectorAll('dialog[open]').length`), 0, 'Esc closes the question');
    await click(tab, '[data-selection-action="delete"]');
    await tab.until(confirmOpen);
    await clickBackdrop(tab);
    await tab.wait(400);
    assert.equal(await tab.evaluate(`document.querySelectorAll('dialog[open]').length`), 0, 'a click away closes the question');
    assert.deepEqual(await writesOf(tab), [], 'closing the question wrote nothing');
    assert.equal(await tab.evaluate(countText), '2개 선택됨', 'and the selection is untouched');
    // Confirm: link 3's request fails, link 2's goes through.
    await click(tab, '[data-selection-action="delete"]');
    await tab.until(confirmOpen);
    await tab.evaluate(`${dialogButton('삭제', true)}.click(); true`);
    await tab.until(`document.querySelector('[data-selection-count]')?.textContent.trim() === '1개 선택됨'`, 15_000);
    await tab.wait(400);
    assert.deepEqual((await writesOf(tab)).map(entry => `${entry.method} ${entry.path}`).sort(), ['DELETE /api/v1/items/2', 'DELETE /api/v1/items/3']);
    assert.equal(await tab.evaluate(barUp), true, 'the bar stays for a retry');
    assert.equal(await tab.evaluate(`(() => { const li = document.querySelectorAll('li[data-selected="true"]'); return li.length; })()`), 1, 'exactly the failed link stays chosen');
    assert.equal(await tab.evaluate(`document.body.textContent.includes('실패') || document.body.textContent.includes('못했')`), true, 'the partial result is said');
  } finally { await tab.close(); }
});

it('일괄 (컬렉션 상세, Owner): 컬렉션으로 이동 = one transfer per own link into the chosen Collection; 컬렉션에서 제거 with a failing link keeps only it selected', async () => {
  const tab = await openScene('collection', '&failOn=10%2Fitems%2F2', READY4);
  try {
    await pick(tab, [0, 1]);
    await tab.until(barUp);
    const acts = (await actionsOf(tab)).map(a => a.replace(':disabled', ''));
    for (const need of ['remove', 'move', 'copyTo', 'copy']) assert.ok(acts.includes(need), `Owner action ${need} (${acts})`);
    // remove: link 2 fails
    await click(tab, '[data-selection-action="remove"]');
    await tab.until(confirmOpen);
    await tab.evaluate(`${dialogButton('삭제', true)}.click(); true`);
    await tab.until(`document.querySelector('[data-selection-count]')?.textContent.trim() === '1개 선택됨'`, 15_000);
    assert.deepEqual((await writesOf(tab)).map(entry => `${entry.method} ${entry.path}`).sort(), ['DELETE /api/v1/collections/10/items/1', 'DELETE /api/v1/collections/10/items/2']);
    await tab.evaluate(`sessionStorage.removeItem('writes'); true`);
  } finally { await tab.close(); }
  const move = await openScene('collection', '', READY4);
  try {
    await pick(move, [0, 1]);
    await move.until(barUp);
    await click(move, '[data-selection-action="move"]');
    await move.until(`!!document.querySelector('dialog[open] [aria-pressed]')`, 20_000);
    await move.wait(400);
    await move.evaluate(`[...document.querySelectorAll('dialog[open] button')].find(b => b.textContent.includes('Design inspiration')).click(); true`);
    await move.wait(200);
    await click(move, '[data-destination-submit]');
    await move.until(`!document.querySelector('dialog[open]')`, 15_000);
    await move.wait(500);
    const writes = await writesOf(move);
    assert.equal(writes.length, 2, 'one move per link');
    for (const entry of writes) {
      assert.equal(entry.method, 'POST');
      assert.match(entry.path, /^\/api\/v1\/collections\/10\/items\/[12]\/move$/);
      assert.deepEqual(entry.body, { targetCollectionId: 12 });
    }
  } finally { await move.close(); }
});

it('일괄 권한 (공유 컬렉션, 기여자): 타인의 링크는 신고·복사만, 내 링크는 제거·이동까지, 섞이면 내 링크만 제거; the report question closes without a write', async () => {
  const tab = await openScene('collection', '&cid=15', READY4);
  try {
    // links 1-4 are mine, 5+ were added by Mina (the stub's isMine flag).
    await pick(tab, [5]);
    await tab.until(barUp);
    const others = (await actionsOf(tab)).map(a => a.replace(':disabled', ''));
    assert.ok(others.includes('report'), `report is offered for someone else's link (${others})`);
    assert.ok(!others.includes('remove') && !others.includes('move'), `no remove / move for someone else's link (${others})`);
    await click(tab, '[data-selection-action="report"]');
    await tab.until(confirmOpen, 10_000);
    await pressEscape(tab);
    await tab.wait(400);
    assert.equal(await tab.evaluate(`document.querySelectorAll('dialog[open]').length`), 0, 'Esc closes the report question');
    assert.deepEqual(await writesOf(tab), [], 'no report is sent by closing the question');
    await pick(tab, [5]);
    await tab.until(barDown);
    await pick(tab, [0]);
    await tab.until(barUp);
    const mine = (await actionsOf(tab)).map(a => a.replace(':disabled', ''));
    assert.ok(mine.includes('remove') && mine.includes('move'), `my own link can be removed / moved (${mine})`);
    assert.ok(!mine.includes('report'), `no report for my own link (${mine})`);
    // Mixed (policy of selectionRules.collectionLinkActions, same as mobile): a member cannot remove in a mixed selection - copy and report only.
    await pick(tab, [5]);
    await tab.wait(300);
    assert.equal(await tab.evaluate(countText), '2개 선택됨');
    const mixed = (await actionsOf(tab)).map(a => a.replace(':disabled', ''));
    assert.ok(!mixed.includes('remove') && !mixed.includes('move'), `a mixed selection offers no remove / move (${mixed})`);
    assert.ok(mixed.includes('copy') && mixed.includes('report'), `but copy and report (${mixed})`);
    await pick(tab, [5]);
    await tab.wait(300);
    // My own link alone: 제거 sends exactly its DELETE.
    await click(tab, '[data-selection-action="remove"]');
    await tab.until(confirmOpen);
    await tab.evaluate(`${dialogButton('삭제', true)}.click(); true`);
    await tab.until(`!document.querySelector('dialog[open]')`, 15_000);
    await tab.wait(500);
    assert.deepEqual((await writesOf(tab)).map(entry => `${entry.method} ${entry.path}`), ['DELETE /api/v1/collections/15/items/1'], "someone else's link is never removed by a member");
  } finally { await tab.close(); }
});

it('일괄 (컬렉션 목록): 즐겨찾기 = one PUT per Collection; 삭제 only for my own, 나가기 only for shared ones; Esc / clicking away on the question writes nothing; a locked Collection offers no 잠금', async () => {
  const tab = await openScene('collections', '', `document.querySelectorAll('a[href^="/collections/"]').length >= 3`);
  try {
    await clickText(tab, '전체');
    await tab.until(READY4, 15_000);
    await tab.wait(500);
    // 12 (own), 15 (shared with me as a contributor)
    await pick(tab, [2, 5]);
    await tab.until(barUp);
    const acts = (await actionsOf(tab)).map(a => a.replace(':disabled', ''));
    assert.ok(acts.includes('favorite'), `favorite (${acts})`);
    assert.ok(acts.includes('leave'), `나가기 for the shared one (${acts})`);
    assert.ok(acts.includes('delete'), `삭제 for the own one (${acts})`);
    // 삭제: the question first; Esc and a click away write nothing.
    await click(tab, '[data-selection-action="delete"]');
    await tab.until(confirmOpen);
    await pressEscape(tab);
    await tab.wait(400);
    await click(tab, '[data-selection-action="delete"]');
    await tab.until(confirmOpen);
    await clickBackdrop(tab);
    await tab.wait(400);
    assert.deepEqual(await writesOf(tab), [], 'closing the question wrote nothing');
    assert.equal(await tab.evaluate(countText), '2개 선택됨');
    // 나가기 only touches the shared one.
    await click(tab, '[data-selection-action="leave"]');
    await tab.until(confirmOpen);
    await tab.evaluate(`[...document.querySelectorAll('dialog[open] button')].pop().click(); true`);
    await tab.until(`!document.querySelector('dialog[open]')`, 15_000);
    await tab.wait(500);
    assert.deepEqual((await writesOf(tab)).map(entry => `${entry.method} ${entry.path}`), ['DELETE /api/v1/collections/15/collaborators/me']);
    await tab.evaluate(`sessionStorage.removeItem('writes'); true`);
  } finally { await tab.close(); }
  const fav = await openScene('collections', '', `document.querySelectorAll('a[href^="/collections/"]').length >= 3`);
  try {
    await clickText(fav, '전체');
    await fav.until(READY4, 15_000);
    await fav.wait(500);
    await pick(fav, [2, 3]);
    await fav.until(barUp);
    await click(fav, '[data-selection-action="favorite"]');
    await fav.wait(800);
    assert.deepEqual((await writesOf(fav)).map(entry => `${entry.method} ${entry.path} ${JSON.stringify(entry.body)}`).sort(), ['PUT /api/v1/collections/12/favorite {"isFavorite":true}', 'PUT /api/v1/collections/13/favorite {"isFavorite":true}']);
    // The locked Collection (14) alone: no 잠금 to offer.
    await fav.evaluate(`document.querySelector('[data-selection-bar] button[aria-label="선택 종료"]')?.click(); true`);
    await fav.until(barDown);
    await pick(fav, [4]);
    await fav.until(barUp);
    assert.ok(!(await actionsOf(fav)).some(a => a.startsWith('lock')), 'a locked Collection offers no 잠금');
  } finally { await fav.close(); }
});

// ---- 다국어: ko / en / ja / zh-Hans / vi / ar (RTL) at every width, Light and Dark -------------------------------------------------

const LANGS = ['ko', 'en', 'ja', 'zh-Hans', 'vi', 'ar'];

/** A real mouse click (CDP input): it carries user activation, so Chrome keeps stacked dialogs as separate Esc steps - a scripted element.click() does not. */
async function realClick(tab, selector) {
  const point = await tab.evaluate(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); el.scrollIntoView({ block: 'center' }); const r = el.getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; })()`);
  await tab.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: point.x, y: point.y, button: 'left', clickCount: 1 });
  await tab.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: point.x, y: point.y, button: 'left', clickCount: 1 });
}

/** In-page measurements of what is on screen right now: dialogs inside the window, buttons that hold their own text, nothing overlapping. */
const SCREEN_FACTS = `(() => {
  const vw = innerWidth, vh = innerHeight;
  const visible = el => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden'; };
  const dialogs = [...document.querySelectorAll('dialog[open]')].map(d => { const r = d.querySelector('[class*="quickPanel"], [class*="panelDialog"], [class*="dialog"]') ? d.getBoundingClientRect() : d.getBoundingClientRect(); return { l: Math.round(r.left), t: Math.round(r.top), r: Math.round(r.right), b: Math.round(r.bottom) }; }).filter(r => r.r - r.l < vw + 1 && r.b - r.t < vh + 1);
  const groups = [['dialog[open] [class*="formActions"]'], ['[data-selection-bar] [class*="selectionBarActions"]'], ['[data-item-detail] footer'], ['dialog[open] [class*="dialogFoot"]']];
  const overlaps = []; const unfit = [];
  const roots = [...document.querySelectorAll('dialog[open] [class*="formActions"], [data-selection-bar], [data-item-detail] footer, dialog[open] [class*="dialogFoot"], dialog[open] [class*="dialogActions"]')];
  for (const root of roots) {
    const buttons = [...root.querySelectorAll('button')].filter(visible);
    for (let i = 0; i < buttons.length; i++) {
      const a = buttons[i].getBoundingClientRect();
      if (a.right > vw + 1 || a.left < -1 || a.bottom > vh + 1) unfit.push('offscreen:' + (buttons[i].textContent || buttons[i].getAttribute('aria-label') || '').trim().slice(0, 24));
      if (buttons[i].scrollWidth > buttons[i].clientWidth + 1) unfit.push('clipped:' + (buttons[i].textContent || '').trim().slice(0, 24) + ' ' + buttons[i].scrollWidth + '>' + buttons[i].clientWidth);
      for (let j = i + 1; j < buttons.length; j++) {
        const b = buttons[j].getBoundingClientRect();
        if (!(a.right <= b.left + 1 || b.right <= a.left + 1 || a.bottom <= b.top + 1 || b.bottom <= a.top + 1)) overlaps.push((buttons[i].textContent || '').trim().slice(0, 16) + ' x ' + (buttons[j].textContent || '').trim().slice(0, 16));
      }
    }
  }
  const focus = document.activeElement ? document.activeElement.tagName + (document.activeElement.type ? ':' + document.activeElement.type : '') : null;
  return { dialogs, overlaps, unfit, focus, dir: document.querySelector('[dir]')?.getAttribute('dir') };
})()`;

async function checkScreen(tab, label) {
  const facts = await tab.evaluate(SCREEN_FACTS);
  assert.deepEqual(facts.overlaps, [], `${label}: buttons overlap`);
  assert.deepEqual(facts.unfit, [], `${label}: a button is clipped or off screen`);
  return facts;
}
const keepShot = (lang, width) => lang === 'ko' || (lang === 'ar' && width !== 1024) || width === 360 || width === 1440;

for (const lang of LANGS) {
  for (const theme of THEMES) {
    for (const width of WIDTHS) {
      if (process.env.POLISH_NO_I18N) continue;
      it(`다국어 ${lang} ${width}px ${theme}: 링크 상세 + 컬렉션 선택 + 닫기 / 삭제 확인`, async () => {
        const { tab, errors } = await open('detail', width, theme, { lang, at: '/', waitFor: `!!document.querySelector('[data-item-detail] [data-detail-save]')` });
        try {
          const detail = await checkScreen(tab, `${lang} ${width} ${theme} detail`);
          assert.equal(detail.dir, lang === 'ar' ? 'rtl' : 'ltr');
          if (keepShot(lang, width)) await shot(tab, `i18n-detail-${lang}-${width}-${theme}`);
          await generic(tab, errors, `i18n detail ${lang} ${width} ${theme}`);
          await tab.until(`!document.querySelector('[data-edit-collections]').disabled`, 15_000);
          // Collections dialog
          await realClick(tab, '[data-edit-collections]');
          await tab.until(`!!document.querySelector('dialog[open] [aria-pressed]')`, 20_000);
          await tab.wait(400);
          const dlg = await checkScreen(tab, `${lang} ${width} ${theme} collections dialog`);
          assert.ok(dlg.dialogs.length >= 1 && dlg.dialogs.every(r => r.l >= -1 && r.t >= -1), 'the dialog is inside the window');
          if (keepShot(lang, width)) await shot(tab, `i18n-collections-${lang}-${width}-${theme}`);
          await pressEscape(tab);
          await tab.wait(400);
          // Leave question (unsaved memo)
          await tab.evaluate(typeInto(MEMO, '입력 중 / typing / 入力中 / 输入中 / đang nhập / جارٍ الكتابة'));
          await tab.wait(150);
          await realClick(tab, 'dialog[open] header button');
          await tab.until(`document.querySelectorAll('dialog[open]').length >= 2`, 10_000);
          await tab.wait(300);
          await checkScreen(tab, `${lang} ${width} ${theme} leave question`);
          if (keepShot(lang, width)) await shot(tab, `i18n-leave-${lang}-${width}-${theme}`);
          await pressEscape(tab);
          await tab.wait(400);
          // Delete question: Esc and a click away both write nothing.
          await realClick(tab, '[data-item-detail] footer button');
          await tab.until(`document.querySelectorAll('dialog[open]').length >= 2`, 10_000);
          await tab.wait(300);
          await checkScreen(tab, `${lang} ${width} ${theme} delete question`);
          if (keepShot(lang, width)) await shot(tab, `i18n-delete-${lang}-${width}-${theme}`);
          await pressEscape(tab);
          await tab.wait(300);
          assert.deepEqual(await writesOf(tab), [], 'closing the questions wrote nothing');
        } finally { await tab.close(); }
      });

      it(`다국어 ${lang} ${width}px ${theme}: 선택 바 + 삭제 확인`, async () => {
        const { tab, errors } = await open('home', width, theme, { lang, at: '/', waitFor: READY4 });
        try {
          await tab.evaluate(`document.querySelectorAll('[data-select-check]')[1].click(); document.querySelectorAll('[data-select-check]')[2].click(); true`);
          await tab.until(barUp);
          await tab.wait(450);
          await checkScreen(tab, `${lang} ${width} ${theme} selection bar`);
          if (keepShot(lang, width)) await shot(tab, `i18n-selection-${lang}-${width}-${theme}`);
          await generic(tab, errors, `i18n selection ${lang} ${width} ${theme}`);
          await realClick(tab, '[data-selection-action="delete"]');
          await tab.until(`document.querySelectorAll('dialog[open]').length >= 1`, 10_000);
          await tab.wait(300);
          await checkScreen(tab, `${lang} ${width} ${theme} delete confirm`);
          if (keepShot(lang, width)) await shot(tab, `i18n-selection-confirm-${lang}-${width}-${theme}`);
          await pressEscape(tab);
          await tab.wait(300);
          assert.deepEqual(await writesOf(tab), []);
        } finally { await tab.close(); }
      });

      it(`다국어 ${lang} ${width}px ${theme}: 링크 저장 + 새 컬렉션`, async () => {
        const { tab, errors } = await open('save', width, theme, { lang, at: '/', waitFor: `!!document.querySelector('[data-collection-create]')` });
        try {
          await tab.wait(1500);
          if (keepShot(lang, width)) await shot(tab, `i18n-save-${lang}-${width}-${theme}`);
          await generic(tab, errors, `i18n save ${lang} ${width} ${theme}`);
          await click(tab, '[data-collection-create]');
          await tab.until(`!!document.querySelector('dialog[open] [data-collection-preview]')`, 15_000);
          await tab.wait(500);
          const facts = await checkScreen(tab, `${lang} ${width} ${theme} new collection`);
          assert.match(facts.focus ?? '', /^INPUT/, 'the name field has the keyboard focus (not the scrolling body)');
          assert.ok(facts.dialogs.length >= 1);
          const reach = await tab.evaluate(`(() => { const d = document.querySelector('dialog[open]'); const foot = [...d.querySelectorAll('[class*="formActions"] button')]; const r = d.getBoundingClientRect(); return { n: foot.length, inside: foot.every(b => { const x = b.getBoundingClientRect(); return x.top >= r.top && x.bottom <= r.bottom + 1 && x.left >= 0 && x.right <= innerWidth; }) }; })()`);
          assert.equal(reach.n, 2);
          assert.equal(reach.inside, true, '취소 / 만들기 stay inside the dialog and the window');
          if (keepShot(lang, width)) await shot(tab, `i18n-newcollection-${lang}-${width}-${theme}`);
          // The keyboard reaches the footer: Tab from the name field moves on (focus is not trapped on the body).
          await tab.key('Tab', 'Tab', 9);
          assert.notEqual(await tab.evaluate(`document.activeElement?.tagName`), 'BODY');
        } finally { await tab.close(); }
      });
    }
  }
}

it('중첩 모달: Esc on the Collection dialog closes ONLY that dialog - the details sheet and its typed edits stay', async () => {
  const tab = await openDetail();
  try {
    await tab.until(`!document.querySelector('[data-edit-collections]').disabled`, 15_000);
    await tab.evaluate(typeInto(MEMO, '남아 있어야 하는 메모'));
    await click(tab, '[data-edit-collections]');
    await tab.until(`!!document.querySelector('dialog[open] [aria-pressed]')`, 20_000);
    await tab.wait(400);
    await pressEscape(tab);
    await tab.wait(600);
    const state = await tab.evaluate(`({ open: document.querySelectorAll('dialog[open]').length, detail: !!document.querySelector('[data-item-detail]'), memo: document.querySelector('${MEMO}')?.value, url: location.pathname + location.search })`);
    assert.equal(state.detail, true, `the details sheet is still there (${JSON.stringify(state)})`);
    assert.equal(state.memo, '남아 있어야 하는 메모', 'the typed memo is kept');
    assert.equal(state.open, 1, 'only the sheet itself is open');
  } finally { await tab.close(); }
});

// ---- layout round 5: details foot, 보관함 feed, 친구 tabs, 삭제 이력, profile ---------------------------------------------------------

const L5_WIDTHS = [390, 768, 1024, 1440, 1920];
const rect = `(el => { const r = el.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom, w: r.width, h: r.height }; })`;

async function openL5(scene, width, theme, { extra = '', lang = 'ko', ready, store, keepCalls = false } = {}) {
  const url = `${origin}/polish-test-harness?scene=${scene}&at=%2F&lang=${lang}${extra}`;
  const tab = await openPage(findChrome(), url, chromePort++);
  const errors = [];
  tab.onEvent(event => {
    if (event.method === 'Runtime.exceptionThrown') errors.push(event.params.exceptionDetails.text + ' ' + (event.params.exceptionDetails.exception?.description ?? '').slice(0, 240));
  });
  await tab.send('Runtime.enable');
  await tab.send('Emulation.setDeviceMetricsOverride', { width, height: width >= 1920 ? 1080 : width >= 1024 ? 900 : 844, deviceScaleFactor: 1, mobile: width < 600 });
  await tab.until(`location.pathname.includes('polish-test-harness') && document.readyState === 'complete' && !!document.querySelector('main')`, 60_000);
  await tab.evaluate(`localStorage.setItem('juple.themePreference', '${theme}'); localStorage.setItem('juple.desktopSidebar', 'expanded'); ${store ? `localStorage.setItem(${JSON.stringify(store[0])}, ${JSON.stringify(store[1])});` : ''} window.__beforeReload = true; setTimeout(() => location.reload(), 50); true`);
  await tab.until(`window.__beforeReload === undefined && document.documentElement.dataset.theme === '${theme}' && document.readyState === 'complete' && !!document.querySelector('main')`, 60_000);
  await tab.until(ready, 30_000);
  await tab.evaluate(`sessionStorage.removeItem('writes'); ${keepCalls ? '' : "sessionStorage.removeItem('calls');"} true`);
  await tab.wait(900);
  return { tab, errors };
}
const callsOf = async tab => JSON.parse(await tab.evaluate(`sessionStorage.getItem('calls') ?? '[]'`));

// 1) details foot: 삭제 + 저장 side by side at the END of the foot
for (const theme of THEMES) {
  for (const width of L5_WIDTHS) {
    it(`레이아웃 ① 링크 상세 푸터 ${width}px ${theme}: 삭제 + 저장 나란히, 같은 높이, 오른쪽 끝, 저장이 Primary`, async () => {
      const { tab, errors } = await openL5('detail', width, theme, { ready: `!!document.querySelector('[data-item-detail] [data-detail-save]')` });
      try {
        const f = await tab.evaluate(`(() => { const R = ${rect}; const foot = document.querySelector('[data-item-detail] footer'); const [del, save] = foot.querySelectorAll('button'); const fr = R(foot); const d = R(del), s = R(save); const cs = x => getComputedStyle(x); return { fr, d, s, delBorder: cs(del).borderTopColor, delColor: cs(del).color, saveBg: cs(save).backgroundColor, saveDisabled: save.disabled, rtl: getComputedStyle(foot).direction }; })()`);
        assert.ok(Math.abs(f.d.h - f.s.h) <= 1, `same height (${f.d.h} / ${f.s.h})`);
        assert.ok(f.s.l >= f.d.r - 1 && f.s.l - f.d.r <= 28, `삭제 and 저장 sit side by side (gap ${f.s.l - f.d.r}px)`);
        if (width > 640) {
          assert.ok(f.d.l > f.fr.l + f.fr.w * 0.4, `at the end of the foot, not at its far start (삭제 starts at ${Math.round(f.d.l - f.fr.l)} of ${Math.round(f.fr.w)})`);
          assert.ok(f.s.w <= 220 && f.d.w <= 220, `neither button is stretched (${Math.round(f.d.w)} / ${Math.round(f.s.w)})`);
          assert.ok(f.s.w >= f.d.w - 1, '저장 is the broader one');
        } else {
          assert.ok(Math.abs(f.s.w - f.d.w) <= 2, `a phone: equal widths (${Math.round(f.d.w)} / ${Math.round(f.s.w)})`);
        }
        assert.ok(f.fr.r - f.s.r <= 40, `저장 ends at the foot's end (${Math.round(f.fr.r - f.s.r)}px)`);
        assert.notEqual(f.delBorder, 'rgba(0, 0, 0, 0)', '삭제 keeps its (red) outline');
        await shot(tab, `l5-detail-foot-${width}-${theme}`);
        await generic(tab, errors, `detail foot ${width} ${theme}`);
      } finally { await tab.close(); }
    });
  }
}

// 2) 보관함: one continuous newest-first feed
for (const theme of THEMES) {
  for (const width of L5_WIDTHS) {
    for (const view of ['list', 'grid']) {
      it(`레이아웃 ② 보관함 ${view} ${width}px ${theme}: 날짜 그룹 없이 하나의 연속 피드`, async () => {
        const { tab, errors } = await openL5('archive', width, theme, { store: ['juple.web.archiveViewMode', view], ready: READY4, keepCalls: true });
        try {
          const calls = await callsOf(tab);
          assert.ok(!calls.some(call => call.includes('/history/sections')), `the section list is never read (${calls.join(' | ')})`);
          const historyCalls = calls.filter(call => call.startsWith('GET /api/v1/items/history?'));
          assert.ok(historyCalls.length >= 1 && historyCalls.every(call => !/fromUtc|toUtc/.test(call)), `one feed query without a date window (${historyCalls.join(' | ')})`);
          const dom = await tab.evaluate(`(() => { const main = document.querySelector('main'); const links = [...main.querySelectorAll('li a[href^="/items/"]')]; const tops = links.map(a => Math.round(a.closest('li').getBoundingClientRect().top)); return { accordions: [...main.querySelectorAll('button[aria-expanded]')].filter(b => !b.closest('[class*="pageHeader"]') && !b.closest('[class*="stickyControls"]')).length, headings: [...main.querySelectorAll('h2, h3')].map(h => h.textContent.trim()), hrefs: links.map(a => a.getAttribute('href')), tops, lefts: links.map(a => Math.round(a.closest('li').getBoundingClientRect().left)), n: main.querySelectorAll('ul').length }; })()`);
          const pressed = await tab.evaluate(`document.querySelector('[role=group] button[aria-pressed=true]')?.getAttribute('aria-label')`);
          assert.equal(pressed, view === 'grid' ? '그리드 보기' : '목록 보기', 'the view switch shows the view that is drawn');
          assert.equal(dom.accordions, 0, 'no date accordion');
          assert.ok(!dom.headings.some(text => /오늘|어제|이번 주|2026년/.test(text)), `no date headings (${dom.headings})`);
          assert.deepEqual(dom.hrefs, [...dom.hrefs].sort((a, b) => Number(a.split('/').pop()) - Number(b.split('/').pop())), 'newest saved first (the server order is kept)');
          assert.equal(dom.hrefs.length, 8);
          const columns = new Set(dom.lefts).size;
          if (view === 'grid') {
            const expected = width >= 1440 ? 3 : width >= 1024 ? 2 : width >= 768 ? 2 : 1;
            assert.ok(columns >= expected, `the grid fills the width with ${columns} columns (>= ${expected} at ${width}px)`);
          } else {
            assert.equal(columns, 1, 'the list is one column of rows');
          }
          await shot(tab, `l5-archive-${view}-${width}-${theme}`);
          await generic(tab, errors, `archive ${view} ${width} ${theme}`);
        } finally { await tab.close(); }
      });
    }
  }
}

it('레이아웃 ② 보관함 검색: a search stays ONE feed (q=…, no sections, no date groups) and clearing it returns to the same feed', async () => {
  const { tab } = await openL5('archive', 1280, 'light', { ready: READY4, keepCalls: true });
  try {
    await tab.evaluate(typeInto('input[type=search], input[type=text], input:not([type])', '청소'));
    await tab.wait(1200);
    const calls = await callsOf(tab);
    assert.ok(calls.some(call => /history\?.*q=%EC%B2%AD%EC%86%8C|history\?.*q=청소/.test(call)), `the server is asked with q (${calls.join(' | ')})`);
    assert.ok(!calls.some(call => call.includes('/history/sections')));
    assert.equal(await tab.evaluate(`[...document.querySelectorAll('main button[aria-expanded]')].filter(b => !b.closest('[class*="pageHeader"]') && !b.closest('[class*="stickyControls"]')).length`), 0);
    await tab.evaluate(typeInto('input[type=search], input[type=text], input:not([type])', ''));
    await tab.wait(1200);
    assert.equal(await tab.evaluate(`[...document.querySelectorAll('main button[aria-expanded]')].filter(b => !b.closest('[class*="pageHeader"]') && !b.closest('[class*="stickyControls"]')).length`), 0, 'back to the full feed - still no sections');
  } finally { await tab.close(); }
});

// 3) 친구: four tabs, the blocked list in the fourth
const FRIEND_READY = `document.querySelectorAll('[role=tab]').length === 4 && !!document.querySelector('[class*="friendCards"] li')`;
for (const theme of THEMES) {
  for (const width of L5_WIDTHS) {
    it(`레이아웃 ③ 친구 ${width}px ${theme}: 탭 4개(친구·받은 요청·보낸 요청·차단한 사용자), 위쪽 별도 버튼 없음, 선택 필이 이동`, async () => {
      const { tab, errors } = await openL5('friends', width, theme, { ready: FRIEND_READY });
      try {
        const facts = await tab.evaluate(`(() => { const R = ${rect}; const tabs = [...document.querySelectorAll('[role=tab]')]; return { n: tabs.length, h: tabs.map(t => Math.round(R(t).h)), heights: new Set(tabs.map(t => Math.round(R(t).h))).size, label: tabs.map(t => t.textContent.trim()), topBtn: !!document.querySelector('main a[href=\"/me/blocked-users\"]'), selected: tabs.map(t => t.getAttribute('aria-selected')) }; })()`);
        assert.equal(facts.n, 4);
        assert.equal(facts.heights, 1, `every tab has the same height (${facts.h})`);
        assert.equal(facts.topBtn, false, 'no separate 차단한 사용자 button');
        assert.deepEqual(facts.selected, ['true', 'false', 'false', 'false']);
        const pill = () => tab.evaluate(`(() => { const p = document.querySelector('[class*="slidePill"]'); const r = p.getBoundingClientRect(); const sel = document.querySelector('[role=tab][aria-selected=true]').getBoundingClientRect(); return { x: Math.round(r.left), w: Math.round(r.width), selX: Math.round(sel.left), selW: Math.round(sel.width), op: getComputedStyle(p).opacity }; })()`);
        const first = await pill();
        assert.ok(Math.abs(first.x - first.selX) <= 2 && Math.abs(first.w - first.selW) <= 2, `the pill sits under the selected tab ${JSON.stringify(first)}`);
        // each tab: selection + content
        const seen = [first.x];
        for (const [index, content] of [[1, `document.querySelectorAll('[class*="requestCards"] li, [class*="friendCards"] li, [class*="personCard"]').length >= 1`], [2, `document.body.textContent.includes('Lee J.')`], [3, `document.querySelectorAll('[data-blocked-user]').length === 2`]]) {
          await tab.evaluate(`document.querySelectorAll('[role=tab]')[${index}].click(); true`);
          await tab.until(content, 10_000);
          await tab.wait(400);
          const state = await pill();
          assert.ok(Math.abs(state.x - state.selX) <= 2 && Math.abs(state.w - state.selW) <= 2, `tab ${index}: the pill follows ${JSON.stringify(state)}`);
          assert.equal(await tab.evaluate(`document.querySelectorAll('[role=tab][aria-selected=true]').length`), 1);
          // the selected tab is fully visible inside the row (a scrolling row brings it into view)
          const visible = await tab.evaluate(`(() => { const row = document.querySelector('[role=tablist]').getBoundingClientRect(); const s = document.querySelector('[role=tab][aria-selected=true]').getBoundingClientRect(); return s.left >= row.left - 1 && s.right <= row.right + 1; })()`);
          assert.equal(visible, true, `tab ${index} is fully visible and clickable`);
          seen.push(state.x);
        }
        assert.equal(await tab.evaluate(`document.querySelectorAll('[role=tab]')[3].getAttribute('aria-selected')`), 'true');
        await shot(tab, `l5-friends-blocked-${width}-${theme}`);
        await generic(tab, errors, `friends ${width} ${theme}`);
      } finally { await tab.close(); }
    });
  }
}

it('레이아웃 ③ 친구 · 차단한 사용자 탭: the list, 차단 해제 asks first (Esc / clicking away write nothing), confirming sends DELETE .../block; arrow keys move between tabs', async () => {
  const { tab } = await openL5('friends', 1280, 'light', { ready: FRIEND_READY });
  try {
    await tab.evaluate(`document.querySelectorAll('[role=tab]')[3].click(); true`);
    await tab.until(`document.querySelectorAll('[data-blocked-user]').length === 2`, 10_000);
    const unblock = `[...document.querySelectorAll('[data-blocked-user] button')][0]`;
    await tab.evaluate(`${unblock}.click(); true`);
    await tab.until(confirmOpen);
    await pressEscape(tab);
    await tab.wait(400);
    await tab.evaluate(`${unblock}.click(); true`);
    await tab.until(confirmOpen);
    await clickBackdrop(tab);
    await tab.wait(400);
    assert.deepEqual(await writesOf(tab), [], 'closing the question wrote nothing');
    await tab.evaluate(`${unblock}.click(); true`);
    await tab.until(confirmOpen);
    await tab.evaluate(`[...document.querySelectorAll('dialog[open] button')].pop().click(); true`);
    await tab.until(`document.querySelectorAll('[data-blocked-user]').length === 1`, 10_000);
    assert.deepEqual((await writesOf(tab)).map(entry => `${entry.method} ${entry.path}`), ['DELETE /api/v1/users/BLOK0006/block']);
    // keyboard: Left from the last tab goes to the third
    await tab.evaluate(`document.querySelectorAll('[role=tab]')[3].focus(); true`);
    await tab.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'ArrowLeft', code: 'ArrowLeft', windowsVirtualKeyCode: 37 });
    await tab.wait(400);
    assert.equal(await tab.evaluate(`document.querySelectorAll('[role=tab]')[2].getAttribute('aria-selected')`), 'true');
  } finally { await tab.close(); }
});

// 4) 삭제 이력
for (const theme of THEMES) {
  for (const width of L5_WIDTHS) {
    it(`레이아웃 ④ 삭제 이력 ${width}px ${theme}: 비우기는 목록 오른쪽 위, 안내 문구는 마지막 카드 아래 가운데`, async () => {
      const { tab, errors } = await openL5('trash', width, theme, { ready: `document.querySelectorAll('[class*="trashCard"]').length === 4` });
      try {
        const f = await tab.evaluate(`(() => { const R = ${rect}; const main = document.querySelector('main'); const tool = document.querySelector('[data-trash-toolbar]'); const btn = tool.querySelector('button'); const ul = document.querySelector('[class*="trashGrid"]'); const cards = [...ul.querySelectorAll('li')]; const note = document.querySelector('[data-trash-notice]'); const header = document.querySelector('[class*="pageHeader"]'); return { headerButtons: [...header.querySelectorAll('button')].filter(b => /비우기/.test(b.textContent)).length, headerText: header.textContent, btn: R(btn), ul: R(ul), tool: R(tool), last: R(cards[cards.length - 1]), note: R(note), noteText: note.textContent.trim(), noteSize: parseFloat(getComputedStyle(note).fontSize), noteAlign: getComputedStyle(note).textAlign, fixed: getComputedStyle(note).position, vh: innerHeight }; })()`);
        assert.equal(f.headerButtons, 0, '비우기 is not in the page header');
        assert.ok(!/50/.test(f.headerText), 'the limit note is not under the title');
        assert.ok(f.btn.b <= f.ul.t + 1 && f.ul.t - f.btn.b <= 40, `비우기 sits right above the list (${Math.round(f.ul.t - f.btn.b)}px)`);
        assert.ok(Math.abs(f.btn.r - f.ul.r) <= 2, `and at its right end (${Math.round(f.ul.r - f.btn.r)}px)`);
        assert.ok(f.note.t >= f.last.b + 12, `the note is below the last card with room (${Math.round(f.note.t - f.last.b)}px)`);
        assert.ok(f.note.t - f.last.b <= 64, 'but not far away');
        assert.equal(f.noteAlign, 'center');
        assert.ok(Math.abs((f.note.l + f.note.r) / 2 - (f.ul.l + f.ul.r) / 2) <= 3, 'centred under the list');
        assert.ok(f.noteSize <= 14, `small helper text (${f.noteSize}px)`);
        assert.notEqual(f.fixed, 'fixed');
        assert.match(f.noteText, /50/, 'it still names the real limit');
        await shot(tab, `l5-trash-${width}-${theme}`);
        await generic(tab, errors, `trash ${width} ${theme}`);
      } finally { await tab.close(); }
    });
  }
}

it('레이아웃 ④ 삭제 이력: 비우기 asks first (Esc / clicking away write nothing) and sends DELETE /api/v1/items/trash; the note goes with the list; restore keeps its endpoint', async () => {
  const { tab } = await openL5('trash', 1280, 'light', { ready: `document.querySelectorAll('[class*="trashCard"]').length === 4` });
  try {
    const empty = `document.querySelector('[data-trash-toolbar] button').click(); true`;
    await tab.evaluate(empty);
    await tab.until(confirmOpen);
    await pressEscape(tab);
    await tab.wait(400);
    await tab.evaluate(empty);
    await tab.until(confirmOpen);
    await clickBackdrop(tab);
    await tab.wait(400);
    assert.deepEqual(await writesOf(tab), []);
    // restore first
    await tab.evaluate(`[...document.querySelectorAll('[class*="trashCard"] button')].find(b => b.textContent.includes('복구')).click(); true`);
    await tab.until(confirmOpen);
    await tab.evaluate(`[...document.querySelectorAll('dialog[open] button')].pop().click(); true`);
    await tab.until(`document.querySelectorAll('[class*="trashCard"]').length === 3`, 10_000);
    assert.deepEqual((await writesOf(tab)).map(entry => `${entry.method} ${entry.path}`), ['POST /api/v1/items/100/restore']);
    await tab.evaluate(`sessionStorage.removeItem('writes'); true`);
    await tab.evaluate(empty);
    await tab.until(confirmOpen);
    await tab.evaluate(`[...document.querySelectorAll('dialog[open] button')].pop().click(); true`);
    await tab.until(`document.querySelectorAll('[class*="trashCard"]').length === 0`, 10_000);
    assert.deepEqual((await writesOf(tab)).map(entry => `${entry.method} ${entry.path}`), ['DELETE /api/v1/items/trash']);
    assert.equal(await tab.evaluate(`!!document.querySelector('[data-trash-notice]') || !!document.querySelector('[data-trash-toolbar]')`), false, 'an emptied list has neither the button nor the note');
    assert.equal(await tab.evaluate(`!!document.querySelector('[class*="emptyState"]')`), true, 'the empty state shows');
  } finally { await tab.close(); }
  const none = await openL5('trash', 1280, 'light', { extra: '&trash=0', ready: `!!document.querySelector('[class*="emptyState"]')` });
  try {
    assert.equal(await none.tab.evaluate(`!!document.querySelector('[data-trash-notice]') || !!document.querySelector('[data-trash-toolbar]')`), false, 'nothing deleted: only the empty state');
  } finally { await none.tab.close(); }
});

// 5) 프로필
for (const theme of THEMES) {
  for (const width of L5_WIDTHS) {
    it(`레이아웃 ⑤ 프로필 편집 ${width}px ${theme}: 사진 | 닉네임·ID 가로 배치(좁으면 세로), 읽기 편한 너비, 저장·취소 오른쪽 아래`, async () => {
      const { tab, errors } = await openL5('profile', width, theme, { ready: `!!document.querySelector('[class*="profileEditCard"] input')` });
      try {
        const f = await tab.evaluate(`(() => { const R = ${rect}; const card = document.querySelector('[class*="profileEditCard"]'); const av = card.querySelector('[class*="profileEditAvatar"]'); const fields = card.querySelector('[class*="profileEditFields"]'); const nick = card.querySelector('input:not([type=file])'); const actions = card.querySelector('[class*="profileEditActions"]'); const btns = [...actions.querySelectorAll('button')]; const idBox = [...card.querySelectorAll('[class*="profileEditReadOnly"]')][0]; return { card: R(card), av: R(av), fields: R(fields), nick: R(nick), actions: R(actions), btns: btns.map(b => R(b)), idTag: idBox.tagName, idInputs: card.querySelectorAll('input[readonly], input[disabled]:not([type=file])').length, nickValue: nick.value }; })()`);
        assert.ok(f.card.w <= 721, `a readable maximum width (${Math.round(f.card.w)}px)`);
        assert.ok(f.nick.w <= 441, `the nickname field is not endless (${Math.round(f.nick.w)}px)`);
        if (width > 640) {
          assert.ok(f.av.r <= f.fields.l + 1, `photo on the left, name + ID on the right (${Math.round(f.av.r)} <= ${Math.round(f.fields.l)})`);
          assert.ok(f.fields.t < f.av.b && f.av.t < f.fields.b, 'side by side (their rows overlap)');
        } else {
          assert.ok(f.av.b <= f.fields.t + 1, 'a narrow screen stacks them (photo first)');
        }
        assert.ok(f.actions.t >= Math.max(f.av.b, f.fields.b) - 1, 'the buttons are under the section');
        assert.ok(Math.abs(f.btns[f.btns.length - 1].r - f.card.r) <= 2 || width <= 640, '저장 ends at the right edge of the form');
        assert.ok(new Set(f.btns.map(b => Math.round(b.h))).size === 1 && f.btns[0].h >= 43, `the two buttons share one 44px height (${f.btns.map(b => Math.round(b.h))})`);
        assert.equal(f.idTag, 'SPAN', 'the Juple ID stays a read-only value (never an input)');
        assert.equal(f.nickValue, '주플 사용자');
        await shot(tab, `l5-profile-${width}-${theme}`);
        await generic(tab, errors, `profile ${width} ${theme}`);
      } finally { await tab.close(); }
    });
  }
}

it('레이아웃 ⑤ 프로필: 변경 감지 - 저장 / 취소 wake up only with a change; 저장 = PUT .../profile/display-name {displayName}; 취소 restores', async () => {
  const { tab } = await openL5('profile', 1280, 'light', { ready: `!!document.querySelector('[class*="profileEditCard"] input')` });
  try {
    const btns = `[...document.querySelectorAll('[class*="profileEditActions"] button')]`;
    assert.deepEqual(await tab.evaluate(`${btns}.map(b => b.disabled)`), [true, true], 'unchanged: both asleep');
    await tab.evaluate(typeInto('[class*="profileEditCard"] input:not([type=file])', '새 닉네임'));
    await tab.wait(200);
    assert.deepEqual(await tab.evaluate(`${btns}.map(b => b.disabled)`), [false, false]);
    await tab.evaluate(`${btns}[0].click(); true`);
    await tab.wait(300);
    assert.equal(await tab.evaluate(`document.querySelector('[class*="profileEditCard"] input:not([type=file])').value`), '주플 사용자', '취소 restores the saved name');
    await tab.evaluate(typeInto('[class*="profileEditCard"] input:not([type=file])', '새 닉네임'));
    await tab.evaluate(`${btns}[1].click(); true`);
    await tab.until(`document.body.textContent.includes('저장되었습니다') || sessionStorage.getItem('profileUpdates')`, 10_000);
    assert.deepEqual(await writesOf(tab), [{ method: 'PUT', path: '/api/v1/users/me/profile/display-name', body: { displayName: '새 닉네임' } }]);
  } finally { await tab.close(); }
});

// 다국어 for the three new screens
for (const lang of LANGS) {
  for (const theme of THEMES) {
    for (const width of [390, 768, 1440]) {
      it(`레이아웃 다국어 ${lang} ${width}px ${theme}: 친구 탭 · 삭제 이력 · 프로필`, async () => {
        const f = await openL5('friends', width, theme, { lang, ready: FRIEND_READY });
        try {
          await f.tab.evaluate(`document.querySelectorAll('[role=tab]')[3].click(); true`);
          await f.tab.until(`document.querySelectorAll('[data-blocked-user]').length === 2`, 10_000);
          await f.tab.wait(500);
          const tabs = await f.tab.evaluate(`(() => { const row = document.querySelector('[role=tablist]'); const tabs = [...row.querySelectorAll('[role=tab]')]; const r = row.getBoundingClientRect(); return { sel: (() => { const s = document.querySelector('[role=tab][aria-selected=true]').getBoundingClientRect(); return s.left >= r.left - 1 && s.right <= r.right + 1; })(), clipped: tabs.filter(t => t.scrollWidth > t.clientWidth + 1).length, heights: new Set(tabs.map(t => Math.round(t.getBoundingClientRect().height))).size }; })()`);
          assert.equal(tabs.sel, true, 'selected tab visible');
          assert.equal(tabs.clipped, 0, 'no tab clips its own text');
          assert.equal(tabs.heights, 1, 'equal tab heights');
          if (lang === 'ko' || lang === 'vi' || lang === 'ar') await shot(f.tab, `l5-i18n-friends-${lang}-${width}-${theme}`);
          await generic(f.tab, f.errors, `friends ${lang} ${width} ${theme}`);
        } finally { await f.tab.close(); }
        const t = await openL5('trash', width, theme, { lang, ready: `document.querySelectorAll('[class*="trashCard"]').length === 4` });
        try {
          const facts = await t.tab.evaluate(`(() => { const b = document.querySelector('[data-trash-toolbar] button'); const n = document.querySelector('[data-trash-notice]'); const r = b.getBoundingClientRect(); const ul = document.querySelector('[class*="trashGrid"]').getBoundingClientRect(); return { fit: b.scrollWidth <= b.clientWidth + 1, inside: r.right <= innerWidth && r.left >= 0, noteInside: n.getBoundingClientRect().right <= innerWidth + 1 && n.getBoundingClientRect().left >= -1, noteLast: n.getBoundingClientRect().top >= ul.bottom }; })()`);
          assert.deepEqual(facts, { fit: true, inside: true, noteInside: true, noteLast: true });
          if (lang === 'vi' || lang === 'ar') await shot(t.tab, `l5-i18n-trash-${lang}-${width}-${theme}`);
          await generic(t.tab, t.errors, `trash ${lang} ${width} ${theme}`);
        } finally { await t.tab.close(); }
        const p = await openL5('profile', width, theme, { lang, ready: `!!document.querySelector('[class*="profileEditCard"] input')` });
        try {
          const facts = await p.tab.evaluate(`(() => { const btns = [...document.querySelectorAll('[class*="profileEditActions"] button')]; return { fit: btns.every(b => b.scrollWidth <= b.clientWidth + 1), inside: btns.every(b => { const r = b.getBoundingClientRect(); return r.right <= innerWidth + 1 && r.left >= -1; }), overlap: (() => { const [a, b] = btns.map(x => x.getBoundingClientRect()); return !(a.right <= b.left + 1 || b.right <= a.left + 1 || a.bottom <= b.top + 1 || b.bottom <= a.top + 1); })() }; })()`);
          assert.deepEqual(facts, { fit: true, inside: true, overlap: false });
          if (lang === 'vi' || lang === 'ar') await shot(p.tab, `l5-i18n-profile-${lang}-${width}-${theme}`);
          await generic(p.tab, p.errors, `profile ${lang} ${width} ${theme}`);
        } finally { await p.tab.close(); }
      });
    }
  }
}
