// Admin V2 rendering in a real Chrome: every screen at desktop, tablet and phone widths (no horizontal overflow, no runtime
// error), plus the interactions that matter (KPI -> chart, keyboard chart reading, translation gating, the 50/50 user split).
// The real screens run inside the real AdminShell against a fixture API on a temporary route that is always removed again.
// Run: node --test tests/browser/adminV2.browser.mjs   (screenshots: $ADMIN_V2_SHOTS or the OS temp folder)
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, before, it } from 'node:test';
import { findChrome, openPage } from '../../../web/tests/browser/cdp.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const harnessRoot = `${root}app/admin-v2-test-harness`;
const harness = `${harnessRoot}/[inquiryId]`;
const origin = 'http://localhost:3196';
const shots = process.env.ADMIN_V2_SHOTS ?? mkdtempSync(join(tmpdir(), 'juple-admin-v2-'));
let server;
let owned = false;
let port = 9960;

before(async () => {
  assert.ok(findChrome(), 'a local Chrome is required; never silently skip');
  assert.equal(existsSync(harnessRoot), false, 'a previous harness was left behind');
  mkdirSync(harness, { recursive: true });
  owned = true;
  copyFileSync(`${root}tests/browser/adminV2.page.tsx.tpl`, `${harness}/page.tsx`);
  mkdirSync(shots, { recursive: true });
  server = spawn(process.execPath, [`${root}node_modules/next/dist/bin/next`, 'dev', '-p', '3196'], {
    cwd: root,
    stdio: 'ignore',
    env: { ...process.env, NEXT_TELEMETRY_DISABLED: '1' },
  });
  for (let i = 0; i < 120; i++) {
    try {
      if ((await fetch(`${origin}/admin-v2-test-harness/7?page=dashboard`)).status === 200) return;
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  throw new Error('Admin dev server did not start');
});

after(async () => {
  if (server) {
    await new Promise(resolve => spawn('taskkill', ['/PID', String(server.pid), '/T', '/F'], { stdio: 'ignore' }).on('close', resolve));
  }
  if (owned) {
    rmSync(harnessRoot, { recursive: true, force: true });
    const validator = `${root}.next/dev/types/validator.ts`;
    if (existsSync(validator) && readFileSync(validator, 'utf8').includes('admin-v2-test-harness')) {
      rmSync(`${root}.next/dev/types`, { recursive: true, force: true });
    }
  }
});

async function screen(page, { width, height, query = '' }) {
  const tab = await openPage(findChrome(), 'about:blank', port++);
  const errors = [];
  tab.onEvent(event => {
    if (event.method === 'Runtime.exceptionThrown') errors.push(event.params.exceptionDetails?.exception?.description ?? event.params.exceptionDetails?.text);
    if (event.method === 'Runtime.consoleAPICalled' && event.params.type === 'error') errors.push(event.params.args.map(arg => arg.value ?? arg.description).join(' '));
  });
  await tab.send('Runtime.enable');
  // Headless Chrome has no focused window: without this, element.focus() fires no focus event (keyboard chart reading).
  await tab.send('Emulation.setFocusEmulationEnabled', { enabled: true });
  await tab.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: width < 600 });
  const url = `${origin}/admin-v2-test-harness/7?page=${page}${query}`;
  const ready = `document.documentElement?.dataset.v2Harness===${JSON.stringify(page)} && !!document.querySelector('.v2-content h1')`;
  try {
    await tab.send('Page.navigate', { url });
    await openWhenReady(tab, url, ready);
    await tab.until(`!!document.body && !document.querySelector('.v2-skeleton')`, 30_000);
    await tab.wait(250);
  } catch (error) {
    // A tab left open keeps its headless Chrome (and so the whole test run) alive.
    await tab.close();
    throw error;
  }
  return { tab, errors };
}

async function openWhenReady(tab, url, ready) {
  try {
    await tab.until(ready, 90_000);
  } catch {
    // The dev server can reload the page while it compiles (the evaluation context is destroyed mid-poll): navigate once more.
    // A real page error is still caught below by the Runtime listener and check().
    await tab.wait(1000);
    await tab.send('Page.navigate', { url });
    await tab.until(ready, 90_000);
  }
}

async function check({ tab, errors }, name) {
  const overflow = await tab.evaluate(`document.documentElement.scrollWidth - window.innerWidth`);
  const shot = await tab.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  writeFileSync(join(shots, `${name}.png`), Buffer.from(shot.result.data, 'base64'));
  assert.ok(overflow <= 1, `${name}: the page scrolls sideways by ${overflow}px`);
  const unexpected = errors.filter(error => !/Download the React DevTools|\[Fast Refresh\]|HMR/.test(String(error)));
  assert.deepEqual(unexpected, [], `${name}: runtime errors`);
}

const viewports = [
  ['desktop', 1440, 900],
  ['tablet', 834, 1112],
  ['phone', 390, 844],
];

for (const page of ['dashboard', 'users', 'notices', 'notice', 'inquiries', 'inquiry', 'costs', 'app-version', 'settings']) {
  for (const [label, width, height] of viewports) {
    it(`${page} renders without sideways scroll or errors (${label} ${width}px)`, async () => {
      const opened = await screen(page, { width, height, query: page === 'users' ? '&user=1' : '' });
      try {
        await check(opened, `${page}-${label}`);
      } finally {
        await opened.tab.close();
      }
    });
  }
}

it('dashboard: three KPIs; choosing one switches the ONE chart below; the chart reads out values from the keyboard', async () => {
  const opened = await screen('dashboard', { width: 1440, height: 900 });
  const { tab } = opened;
  try {
    assert.equal(await tab.evaluate(`document.querySelectorAll('.v2-kpi').length`), 3);
    assert.equal(await tab.evaluate(`document.querySelectorAll('.v2-chart').length`), 1);
    assert.equal(await tab.evaluate(`document.querySelector('.v2-kpi[aria-pressed="true"] .v2-kpi-label').textContent`), '전체 사용자 수');
    assert.match(await tab.evaluate(`document.querySelector('.v2-kpis').textContent`), /1,284.*48,210.*17/);
    await tab.evaluate(`[...document.querySelectorAll('.v2-kpi')][2].click()`);
    await tab.until(`document.querySelector('.v2-chart-panel h2')?.textContent==='일별 신규 가입자' && document.querySelectorAll('.v2-chart-bar').length===30`);
    assert.equal(await tab.evaluate(`document.querySelectorAll('.v2-chart').length`), 1);
    await tab.evaluate(`document.querySelector('.v2-chart-svg').focus()`);
    await tab.until(`!!document.querySelector('.v2-chart-tooltip')`);
    assert.match(await tab.evaluate(`document.querySelector('.v2-chart-tooltip').textContent`), /10월 28일.*17명/);
    await tab.key('ArrowLeft', 'ArrowLeft', 37);
    assert.match(await tab.evaluate(`document.querySelector('.v2-chart-tooltip').textContent`), /10월 27일/);
    await tab.evaluate(`[...document.querySelectorAll('.v2-period [role=radio]')].find(b=>b.textContent==='7일').click()`);
    await tab.until(`document.querySelectorAll('.v2-chart-bar').length===7`);
    await check(opened, 'dashboard-signups-7d');
  } finally {
    await tab.close();
  }
});

it('users: the table and the selected person\'s chart share the screen half and half on a desktop', async () => {
  const opened = await screen('users', { width: 1440, height: 900, query: '&user=1' });
  const { tab } = opened;
  try {
    await tab.until(`!!document.querySelector('.v2-users-chart .v2-chart')`);
    assert.deepEqual(await tab.evaluate(`[...document.querySelectorAll('.v2-users-list thead th')].map(th=>th.textContent.replace(/[↑↓↕]/g,''))`), ['사용자 아이디', '닉네임', '저장 링크 개수', '언어', '가입일']);
    const [list, chart] = await tab.evaluate(`[...document.querySelectorAll('.v2-users > .v2-panel')].map(p=>p.getBoundingClientRect().height)`);
    assert.ok(Math.abs(list - chart) < 24, `list ${list}px vs chart ${chart}px`);
    assert.equal(await tab.evaluate(`document.querySelector('tr[aria-selected="true"] td').textContent`), '@K7MP4000');
    await tab.evaluate(`[...document.querySelectorAll('.v2-users-chart [role=radio]')].find(b=>b.textContent==='누적').click()`);
    await tab.until(`!!document.querySelector('.v2-users-chart .v2-chart-line')`);
    await check(opened, 'users-cumulative');
  } finally {
    await tab.close();
  }
});

it('users without a selection explain what the bottom half will show', async () => {
  const opened = await screen('users', { width: 1440, height: 900 });
  try {
    assert.match(await opened.tab.evaluate(`document.querySelector('.v2-users-chart').textContent`), /사용자를 선택하면 링크 저장 추이가 표시됩니다/);
  } finally {
    await opened.tab.close();
  }
});

it('inquiry: original and Korean side by side; nothing is sent until a translation of the current Korean answer exists', async () => {
  const opened = await screen('inquiry', { width: 1440, height: 900 });
  const { tab } = opened;
  try {
    assert.match(await tab.evaluate(`document.querySelector('.v2-compare').textContent`), /The app freezes.*긴 인스타그램 링크/s);
    const send = `[...document.querySelectorAll('button')].find(b=>b.textContent==='답변 전송')`;
    assert.equal(await tab.evaluate(`${send}.disabled`), true);
    await tab.evaluate(`document.querySelector('#answer-ko').focus()`);
    await tab.send('Input.insertText', { text: '감사합니다. 1.0 (37) 버전에서 수정했습니다.' });
    assert.equal(await tab.evaluate(`${send}.disabled`), true, 'an English answer cannot go out without its translation');
    await tab.evaluate(`[...document.querySelectorAll('button')].find(b=>b.textContent.includes('번역하기')).click()`);
    await tab.until(`document.querySelector('textarea[aria-label="영어 번역문"]')?.value.startsWith('Thank you')`);
    assert.equal(await tab.evaluate(`${send}.disabled`), false);
    await tab.evaluate(`window.confirm=()=>true; ${send}.click()`);
    await tab.until(`window.calls.some(c=>c.method==='PUT' && c.path.endsWith('/answer'))`);
    const call = await tab.evaluate(`window.calls.find(c=>c.method==='PUT' && c.path.endsWith('/answer'))`);
    assert.deepEqual(call.body, { answer: 'Thank you. We fixed the issue in version 1.0 (37).', sourceKo: '감사합니다. 1.0 (37) 버전에서 수정했습니다.', language: 'en', expectedUpdatedAtUtc: '2026-10-27T09:12:00+00:00' });
    await check(opened, 'inquiry-answered');
  } finally {
    await tab.close();
  }
});

it('notice: 번역 갱신 fills only missing, failed and stale languages and reports the failed ones', async () => {
  const opened = await screen('notice', { width: 1440, height: 900 });
  const { tab } = opened;
  try {
    await tab.until(`document.querySelector('input[maxlength="200"]')?.value==='서버 점검 안내'`);
    const state = code => `[...document.querySelectorAll('.v2-language')].find(b=>b.textContent.startsWith(${JSON.stringify(code)})).querySelector('.v2-badge').textContent`;
    await tab.until(`${state('영어')}==='원문 변경됨'`);
    assert.equal(await tab.evaluate(state('일본어')), '수동 작성');
    await tab.evaluate(`[...document.querySelectorAll('button')].find(b=>b.textContent.includes('번역 갱신')).click()`);
    await tab.until(`window.calls.some(c=>c.method==='POST' && c.path.endsWith('/notices/translations'))`);
    const requested = await tab.evaluate(`window.calls.find(c=>c.method==='POST' && c.path.endsWith('/notices/translations')).body.languages`);
    assert.ok(requested.includes('en'));
    assert.ok(!requested.includes('ja'), 'a hand-written translation is never refreshed automatically');
    assert.ok(!requested.includes('ko'));
    await tab.until(`${state('아랍어')}==='번역 실패'`);
    assert.match(await tab.evaluate(`document.querySelector('.notice-editor [role=status]')?.textContent ?? ''`), /실패/);
    await check(opened, 'notice-translated');
  } finally {
    await tab.close();
  }
});

it('the phone layout opens the navigation as a drawer', async () => {
  const opened = await screen('dashboard', { width: 390, height: 844 });
  const { tab } = opened;
  try {
    assert.equal(await tab.evaluate(`getComputedStyle(document.querySelector('.v2-topbar')).display`), 'flex');
    await tab.evaluate(`document.querySelector('.v2-topbar button').click()`);
    await tab.until(`document.querySelector('.v2-sidebar').classList.contains('open')`);
    await tab.wait(300);
    assert.deepEqual(await tab.evaluate(`[...document.querySelectorAll('.v2-nav .v2-nav-label')].map(x=>x.textContent)`), ['대시보드', '사용자', '공지사항', '문의 관리', '비용 및 수익', '앱 버전 관리']);
    await check(opened, 'phone-drawer');
  } finally {
    await tab.close();
  }
});
