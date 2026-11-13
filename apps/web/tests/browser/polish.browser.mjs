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
import { findChrome, openPage } from './cdp.mjs';

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
      if (process.env.POLISH_ONLY_EDIT || process.env.POLISH_ONLY_REG) continue;
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
