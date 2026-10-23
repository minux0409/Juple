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
    await tab.evaluate(`document.querySelector('[data-fixture-notification]').click()`);
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

const navCount = href => `document.querySelector('nav a[href="${href}"] [data-attention-badge]')?.textContent ?? '0'`;
const typeCount = filter => `document.querySelector('[data-collection-filter="${filter}"] [data-attention-badge]')?.textContent ?? '0'`;
const geometry = `(() => {
  const group = document.querySelector('[data-collection-sections]');
  const rects = [...group.children].map(el => el.getBoundingClientRect());
  return {
    gaps: rects.slice(1).map((rect, i) => rect.top - rects[i].bottom),
    badgesFit: [...document.querySelectorAll('[data-collection-filter] [data-attention-badge],nav [data-attention-badge]')].every(el => {
      const badge = el.getBoundingClientRect(), button = el.parentElement.getBoundingClientRect();
      return badge.left >= button.left && badge.right <= button.right && badge.top >= button.top && badge.bottom <= button.bottom && Math.abs((badge.top + badge.bottom - button.top - button.bottom) / 2) < 1;
    }),
    noHorizontalOverflow: document.documentElement.scrollWidth <= innerWidth,
    sidebarRightAligned: innerWidth < 900 || [...document.querySelectorAll('nav [data-attention-badge]')].every(el => {
      const badge = el.getBoundingClientRect(), label = el.previousElementSibling.getBoundingClientRect(), link = el.parentElement.getBoundingClientRect();
      return badge.left > label.right && link.right - badge.right < 20;
    }),
  };
})()`;

it('real sidebar and type badges deduplicate events, fit at desktop/393/320, and use single 12px section gaps', async () => {
  const tab = await openFixture(`${origin}/invitation-test-harness?tab=shared&fixtureCount=2&fixtureFriends=3&fixtureAttention=1&fixtureNewLinks=1&fixtureUnread=99`);
  const errors = [];
  tab.onEvent(event => {
    if (event.method === 'Runtime.exceptionThrown') errors.push(event.params.exceptionDetails.text);
    if (event.method === 'Runtime.consoleAPICalled' && event.params.type === 'error') errors.push(event.params.args.map(arg => arg.value ?? arg.description).join(' '));
  });
  try {
    await tab.send('Runtime.enable');
    await tab.until(`(${navCount('/collections')}) === '4'`);
    for (const [href, count] of [['/', '0'], ['/archive', '0'], ['/collections', '4'], ['/me/friends', '3'], ['/me', '0']]) assert.equal(await tab.evaluate(navCount(href)), count);
    // Requests belong to 공유 only (2 invitations + 1 owner approval); 설정 never carries the friend number (it is on 친구 only).
    for (const filter of ['all', 'owned', 'favorites']) assert.equal(await tab.evaluate(typeCount(filter)), '0');
    assert.equal(await tab.evaluate(typeCount('shared')), '3');
    assert.equal(await tab.evaluate(`${entry}.textContent.trim()`), '받은 초대 요청2');
    const badgeCalls = async () => JSON.parse(await tab.evaluate(`sessionStorage.getItem('invitationCalls')`)).filter(call =>
      call === 'GET /api/v1/users/me/collection-invitations' || call === 'GET /api/v1/friends/requests' || call === 'GET /api/v1/collections?scope=all&limit=100');
    assert.equal((await badgeCalls()).length, 3, 'shell, collection tabs and entry share three startup reads');
    await tab.evaluate(`window.dispatchEvent(new Event('focus')); document.dispatchEvent(new Event('visibilitychange'))`);
    await tab.wait(300);
    assert.equal((await badgeCalls()).length, 3, 'tab return within 60 seconds reuses badge data');
    for (const width of [1280, 393, 320]) {
      await tab.send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: width < 600 });
      await tab.evaluate(`document.fonts.ready.then(() => new Promise(resolve => requestAnimationFrame(resolve)))`);
      const result = await tab.evaluate(geometry);
      assert.deepEqual(result.gaps, [12, 12, 12], `section spacing ${width}: toolbar, 받은 승인 요청, 받은 초대 요청, search`);
      assert.equal(result.badgesFit, true, `badge center/containment ${width}`);
      assert.equal(result.sidebarRightAligned, true, `sidebar end alignment ${width}`);
      assert.equal(result.noHorizontalOverflow, true, `page overflow ${width}`);
      await capture(tab, `attention-${width}`);
    }
    await tab.evaluate(`document.querySelector('button[aria-controls],button[aria-label^="알림"]').click()`);
    await tab.until(`!![...document.querySelectorAll('button')].find(el => el.textContent === '모두 읽음' && !el.disabled)`);
    await tab.evaluate(`[...document.querySelectorAll('button')].find(el => el.textContent === '모두 읽음').click()`);
    await tab.until(`(${navCount('/collections')}) === '3'`);
    assert.equal(await tab.evaluate(navCount('/me/friends')), '3');
    assert.equal(await tab.evaluate(typeCount('shared')), '3', 'invitations and pending tasks stay after reading notifications');
    assert.equal(await tab.evaluate(`${entry}.textContent.trim()`), '받은 초대 요청2');
    await tab.evaluate(`document.querySelector('[data-fixture-switch-account]').click()`);
    await tab.until(`(${navCount('/collections')}) === '0' && (${navCount('/me/friends')}) === '0' && !${entry}`);
    assert.deepEqual(errors, []);
  } finally { await tab.close(); }
});

it('99+ badges remain inside buttons; zero invitations leaves exactly one 12px gap and no empty wrapper', async () => {
  for (const count of [101, 0]) {
    const tab = await openFixture(`${origin}/invitation-test-harness?tab=shared&fixtureCount=${count}&fixtureFriends=${count}`);
    try {
      await tab.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
      await tab.until(`document.querySelector('section[aria-busy="false"]') && (${navCount('/collections')}) === '${count ? '99+' : '0'}'`);
      await tab.until(`!document.querySelector('section[aria-label="받은 초대 요청"][aria-busy="true"]')`);
      const result = await tab.evaluate(geometry);
      assert.equal(result.badgesFit, true);
      assert.deepEqual(result.gaps, count ? [12, 12] : [12]);
      assert.equal(await tab.evaluate(`!!${entry}`), count > 0);
      await capture(tab, `attention-count-${count}`);
    } finally { await tab.close(); }
  }
});


it('friend notification opens received requests directly, including the already handled empty state', async () => {
  for (const count of [2, 0]) {
    const tab = await openFixture(`${origin}/invitation-test-harness?fixturePage=friends&fixtureFriends=${count}&requests=incoming`);
    try {
      await tab.until(`!!document.querySelector('[role="tab"][aria-selected="true"]') && document.querySelector('[role="tab"][aria-selected="true"]').textContent.includes('받은 요청')`);
      await tab.until(`document.body.textContent.includes('${count ? 'Fixture' : '받은 친구 요청이 없어요'}')`);
      assert.equal(await tab.evaluate(`document.documentElement.scrollWidth <= innerWidth`), true);
      const calls = JSON.parse(await tab.evaluate(`sessionStorage.getItem('invitationCalls')`));
      assert.equal(calls.filter(call => call === 'GET /api/v1/friends/requests').length, 1);
      assert.equal(calls.some(call => call.startsWith('POST ')), false, 'opening a notification never accepts a real request');
      await capture(tab, `friend-requests-${count}`);
    } finally { await tab.close(); }
  }
});

const requestRow = id => `document.querySelector('[data-request-row="${id}"]')`;

it('받은 승인 요청: the shared-tab row lists MY Collections with waiting requests (name, count) and choosing one goes to that Collection page with its requests (the mobile flow)', async () => {
  const tab = await openFixture(`${origin}/invitation-test-harness?tab=shared&fixtureCount=0&fixtureAttention=2`);
  try {
    await tab.until(`!!${requestRow('received-approvals')}`);
    assert.equal(await tab.evaluate(`${requestRow('received-approvals')}.textContent.trim()`), '받은 승인 요청2');
    assert.equal(await tab.evaluate(`${requestRow('received-approvals')}.dataset.requestVariant`), 'action', 'what I must answer keeps the blue row with the red badge');
    // Not on the other types.
    await tab.evaluate(`document.querySelector('[data-collection-filter="all"]').click()`);
    await tab.until(`location.search.includes('tab=all')`);
    assert.equal(await tab.evaluate(`!!${requestRow('received-approvals')}`), false);
    await tab.evaluate(`document.querySelector('[data-collection-filter="shared"]').click()`);
    await tab.until(`!!${requestRow('received-approvals')}`);
    for (const width of [1280, 393, 320]) {
      await tab.send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: width < 600 });
      await tab.evaluate(`document.fonts.ready.then(() => new Promise(resolve => requestAnimationFrame(resolve)))`);
      const fit = await tab.evaluate(`(() => {
        const row = ${requestRow('received-approvals')}, badge = row.querySelector('[data-attention-badge]'), chevron = row.querySelector('svg:last-of-type');
        const r = row.getBoundingClientRect(), b = badge.getBoundingClientRect(), c = chevron.getBoundingClientRect();
        return { inside: b.left >= r.left && b.right <= r.right && b.top >= r.top && b.bottom <= r.bottom, apart: b.right <= c.left + 0.5 || c.right <= b.left + 0.5, noOverflow: document.documentElement.scrollWidth <= innerWidth };
      })()`);
      assert.deepEqual(fit, { inside: true, apart: true, noOverflow: true }, `request row ${width}`);
      await capture(tab, `requests-${width}`);
    }
    await tab.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
    // Step 1 of the mobile flow: ALWAYS the list of Collections first (even with one), never the requests directly.
    await tab.evaluate(`${requestRow('received-approvals')}.click()`);
    await tab.until(`document.querySelectorAll('[data-request-collection]').length === 1`);
    assert.equal(await tab.evaluate(`document.querySelector('[data-submission-id]')`), null, 'no request list opens before a Collection is chosen');
    const pick = await tab.evaluate(`(() => { const b = document.querySelector('[data-request-collection="10"]'); return { text: b.textContent.trim(), badge: b.querySelector('[data-attention-badge]').textContent }; })()`);
    assert.deepEqual(pick, { text: '잡동사니2', badge: '2' });
    await capture(tab, 'requests-collection-list');
    // Step 2-3: the Collection's own page, with its requests (the notification's address).
    await tab.evaluate(`document.querySelector('[data-request-collection="10"]').click()`);
    await tab.until(`location.pathname === '/collections/10' && location.search === '?requests=1'`);
  } finally { await tab.close(); }
});

it('받은 승인 요청: the Collection requests list approves / rejects one at a time, with the original link one click away - and the numbers follow', async () => {
  const tab = await openFixture(`${origin}/invitation-test-harness?fixturePage=requests&fixtureCount=0&fixtureAttention=2`);
  try {
    await tab.until(`document.querySelectorAll('[data-submission-id]').length === 2`);
    assert.equal(await tab.evaluate(`document.querySelector('dialog[open]').textContent.includes('Proposer')`), true, 'who proposed');
    // 바로가기: a plain new-tab anchor to exactly the submitted address; it never answers anything.
    const link = await tab.evaluate(`(() => { const a = document.querySelector('[data-submission-id="1"] a[data-open-original]'); return { href: a.href, target: a.target, rel: a.rel }; })()`);
    assert.deepEqual(link, { href: 'https://example.com/p/1', target: '_blank', rel: 'noopener noreferrer' });
    await capture(tab, 'requests-dialog');
    await tab.evaluate(`document.querySelector('[data-submission-id="1"] button:last-of-type').click()`);
    await tab.until(`document.querySelectorAll('[data-submission-id]').length === 1`);
    await tab.until(`(${navCount('/collections')}) === '1'`);
    await tab.evaluate(`document.querySelector('[data-submission-id="2"] button:first-of-type').click()`);
    await tab.until(`!![...document.querySelectorAll('dialog[open] button')].find(el => el.textContent === '거절' && el.closest('dialog').querySelector('h2')?.textContent.includes('거절할까요'))`);
    await tab.evaluate(`[...document.querySelectorAll('dialog[open] button')].find(el => el.textContent === '거절' && el.closest('dialog').querySelector('h2')?.textContent.includes('거절할까요')).click()`);
    await tab.until(`document.querySelectorAll('[data-submission-id]').length === 0`);
    const calls = JSON.parse(await tab.evaluate(`sessionStorage.getItem('invitationCalls')`));
    assert.equal(calls.filter(call => call === 'POST /api/v1/collections/10/submissions/1/approve').length, 1);
    assert.equal(calls.filter(call => call === 'DELETE /api/v1/collections/10/submissions/2').length, 1);
  } finally { await tab.close(); }
});

it('보낸 승인 요청: one row per request - thumbnail, text, then 바로가기 and 요청 취소 icons at the end - and cancel acts only on its own request', async () => {
  const tab = await openFixture(`${origin}/invitation-test-harness?tab=shared&fixtureCount=0&fixtureMine=3&fixtureAttention=1`);
  await tab.send('Emulation.setDeviceMetricsOverride', { width: 393, height: 900, deviceScaleFactor: 1, mobile: true });
  try {
    await tab.until(`!!${requestRow('sent-approvals')}`);
    assert.equal(await tab.evaluate(`${requestRow('sent-approvals')}.textContent.trim()`), '보낸 승인 요청대기 3건');
    assert.equal(await tab.evaluate(`${requestRow('sent-approvals')}.querySelector('[data-attention-badge]')`), null, 'a status row has no badge');
    assert.equal(await tab.evaluate(`${requestRow('sent-approvals')}.dataset.requestVariant`), 'status');
    await capture(tab, 'sent-and-received-393');
    await tab.evaluate(`${requestRow('sent-approvals')}.click()`);
    await tab.until(`document.querySelectorAll('[data-my-submission-id]').length === 3`);
    // Only what identifies the request: thumbnail, title, address, Collection - no request time and no "승인 대기 중" status (the API still sends them).
    const info = await tab.evaluate(`[...document.querySelectorAll('[data-my-submission-id]')].map(li => ({ text: li.textContent, time: !!li.querySelector('time'), ps: [...li.querySelectorAll('p')].map(p => p.textContent.trim()), collection: li.querySelector('[class*="metaName"]')?.textContent }))`);
    assert.equal(info.length, 3);
    for (const row of info) {
      assert.equal(row.time, false, 'no request time');
      assert.equal(row.text.includes('승인 대기 중'), false, 'no status text');
      assert.equal(/\d{4}\. \d{1,2}\. \d{1,2}\./.test(row.text), false, 'no date anywhere on the row');
      assert.equal(row.collection, '웹툰');
      assert.ok(row.ps[1].startsWith('https://example.com/m/'), 'the address stays');
    }
    for (const width of [1280, 393, 320]) {
      await tab.send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: width < 600 });
      await tab.evaluate(`document.fonts.ready.then(() => new Promise(resolve => requestAnimationFrame(resolve)))`);
      const ellipsis = await tab.evaluate(`(() => { const t = document.querySelector('[data-my-submission-id="900"] p'); const r = t.getBoundingClientRect(); return { oneLine: r.height < 28, clipped: t.scrollHeight > t.clientHeight + 1 || t.scrollWidth > t.clientWidth }; })()`);
      assert.equal(ellipsis.oneLine, true, `a long title is one line ${width}`);
      const layout = await tab.evaluate(`(() => [...document.querySelectorAll('[data-my-submission-id]')].map(li => {
        const r = li.getBoundingClientRect(), open = li.querySelector('a[data-open-original]').getBoundingClientRect(), cancel = li.querySelector('[data-cancel-request]').getBoundingClientRect();
        const text = li.querySelector('p').getBoundingClientRect();
        return { oneRowEnd: open.right <= cancel.left + 0.5 && cancel.right <= r.right + 0.5, sameLine: Math.abs((open.top + open.bottom) / 2 - (cancel.top + cancel.bottom) / 2) < 1, noBigButtonBelow: cancel.height <= 48 && cancel.width <= 48, textBeforeIcons: text.right <= open.left + 0.5, touch: open.width >= 44 && cancel.width >= 44, fit: r.right <= innerWidth };
      }))()`);
      for (const row of layout) assert.deepEqual(row, { oneRowEnd: true, sameLine: true, noBigButtonBelow: true, textBeforeIcons: true, touch: true, fit: true }, `sent row ${width}`);
      assert.equal(await tab.evaluate(`document.documentElement.scrollWidth <= innerWidth`), true, `no horizontal scroll ${width}`);
      await capture(tab, `sent-list-${width}`);
    }
    // Labels / tooltips for the icon buttons; the open icon is a safe new-tab anchor that cancels nothing.
    const labels = await tab.evaluate(`(() => { const li = document.querySelector('[data-my-submission-id="901"]'); const a = li.querySelector('a[data-open-original]'), b = li.querySelector('[data-cancel-request]'); return { open: [a.getAttribute('aria-label'), a.title, a.target, a.rel, a.href], cancel: [b.getAttribute('aria-label'), b.title] }; })()`);
    assert.equal(labels.open[2], '_blank');
    assert.equal(labels.open[3], 'noopener noreferrer');
    assert.equal(labels.open[4], 'https://example.com/m/1');
    assert.ok(labels.open[0] && labels.open[1] && labels.cancel[0] && labels.cancel[1]);
    // Cancel on the SECOND request asks first, then acts on that one only.
    await tab.evaluate(`document.querySelector('[data-cancel-request="901"]').click()`);
    await tab.until(`!![...document.querySelectorAll('dialog[open] button')].find(el => el.textContent === '요청 취소' && el.closest('dialog').querySelector('h2')?.textContent.includes('취소할까요'))`);
    assert.equal(JSON.parse(await tab.evaluate(`sessionStorage.getItem('invitationCalls')`)).filter(call => call.startsWith('DELETE')).length, 0, 'nothing is cancelled before the confirmation');
    await tab.evaluate(`[...document.querySelectorAll('dialog[open] button')].find(el => el.textContent === '요청 취소' && el.closest('dialog').querySelector('h2')?.textContent.includes('취소할까요')).click()`);
    await tab.until(`document.querySelectorAll('[data-my-submission-id]').length === 2`);
    assert.equal(await tab.evaluate(`!!document.querySelector('[data-my-submission-id="901"]')`), false);
    assert.equal(await tab.evaluate(`!!document.querySelector('[data-my-submission-id="900"]') && !!document.querySelector('[data-my-submission-id="902"]')`), true, 'the other requests stay');
    const deletes = JSON.parse(await tab.evaluate(`sessionStorage.getItem('invitationCalls')`)).filter(call => call.startsWith('DELETE'));
    assert.deepEqual(deletes, ['DELETE /api/v1/collections/submissions/mine/901']);
    await tab.evaluate(`document.querySelector('dialog[open] button[aria-label="닫기"]').click()`);
    await tab.until(`${requestRow('sent-approvals')}?.textContent.trim() === '보낸 승인 요청대기 2건'`);
  } finally { await tab.close(); }
});

it('친구 요청: the requester real photo is shown in 받은 / 보낸 요청, the first-letter avatar only where there is none', async () => {
  const tab = await openFixture(`${origin}/invitation-test-harness?fixturePage=friends&fixtureCount=0&fixtureFriends=2`);
  try {
    await tab.until(`[...document.querySelectorAll('[role="tab"]')].some(el => el.textContent.includes('받은') && Object.keys(el).some(key => key.startsWith('__reactProps')))`);
    await tab.evaluate(`[...document.querySelectorAll('[role="tab"]')].find(el => el.textContent.includes('받은')).click()`);
    await tab.until(`document.querySelectorAll('ul li img').length >= 1`);
    await tab.wait(600);
    const incoming = await tab.evaluate(`[...document.querySelectorAll('ul li')].map(li => ({ img: li.querySelector('img') ? { src: li.querySelector('img').src, loaded: li.querySelector('img').naturalWidth > 0 } : null }))`);
    assert.deepEqual(incoming[0].img, { src: 'http://localhost:3198/icon.png', loaded: true }, 'a request with a photo shows it');
    assert.equal(incoming[1].img, null, 'a request without one keeps the fallback');
    await tab.evaluate(`[...document.querySelectorAll('[role="tab"]')].find(el => el.textContent.includes('보낸')).click()`);
    await tab.until(`document.querySelectorAll('ul li img').length >= 1`);
    assert.equal(await tab.evaluate(`document.querySelector('ul li img').src`), 'http://localhost:3198/icon.png');
    await capture(tab, 'friend-request-photo');
  } finally { await tab.close(); }
});

const cardGeometry = id => `(() => {
  const card = [...document.querySelectorAll('ul > li')].find(li => li.textContent.includes('${id}'));
  const r = card.getBoundingClientRect(), meta = card.querySelector('[data-site-meta]').getBoundingClientRect(), open = card.querySelector('[data-link-open]').getBoundingClientRect();
  const chips = card.querySelector('[data-card-reactions]');
  const adder = card.querySelector('[data-link-adder]').getBoundingClientRect();
  const out = { openOnLineOne: open.top < meta.bottom + 24 && open.right <= r.right + 0.5 && open.left >= r.left, adderBesideIcon: adder.left >= meta.left && Math.abs((adder.top + adder.bottom) / 2 - (meta.top + meta.bottom) / 2) < 12, hasChips: !!chips };
  if (chips) {
    const c = chips.getBoundingClientRect();
    out.chipsBelow = c.top >= meta.bottom - 1 && c.top >= adder.bottom - 1;
    out.chipsInside = c.left >= r.left && c.right <= r.right + 0.5 && c.bottom <= r.bottom + 0.5;
    out.noClip = [...chips.querySelectorAll('button, [role=img]')].every(el => { const b = el.getBoundingClientRect(); return b.width === 0 || (b.left >= r.left && b.right <= r.right + 0.5 && b.bottom <= r.bottom + 0.5); });
    out.rects = [r.left, r.right, r.bottom, ...[...chips.querySelectorAll('button, [role=img]')].map(el => { const b = el.getBoundingClientRect(); return [Math.round(b.left), Math.round(b.right), Math.round(b.bottom)].join(':'); })];
    out.openClear = open.bottom <= c.top + 1;
  }
  return out;
})()`;

for (const mode of ['grid', 'list']) {
  it(`공유 컬렉션 링크 카드 (${mode}): line 1 = icon + author + 바로가기, line 2 = reactions only while there are any - no clipping at 1280 / 393 / 320`, async () => {
    const tab = await openFixture(`${origin}/invitation-test-harness?fixturePage=links&mode=${mode}&fixtureCount=0`);
    try {
      await tab.until(`document.querySelectorAll('[data-link-adder]').length === 3`);
      for (const width of [1280, 393, 320]) {
        await tab.send('Emulation.setDeviceMetricsOverride', { width, height: 1000, deviceScaleFactor: 1, mobile: width < 600 });
        await tab.evaluate(`document.fonts.ready.then(() => new Promise(resolve => requestAnimationFrame(resolve)))`);
        for (const id of ['아주 긴 링크 제목', '반응 하나']) {
          const g = await tab.evaluate(cardGeometry(id));
          assert.equal(g.openOnLineOne && g.adderBesideIcon && g.hasChips && g.chipsBelow && g.chipsInside && g.noClip && g.openClear, true, `${mode} ${width} ${id}: ${JSON.stringify(g)}`);
        }
        const none = await tab.evaluate(cardGeometry('반응 없음'));
        assert.equal(none.hasChips, false, 'no reactions: no second line');
        assert.equal(none.openOnLineOne && none.adderBesideIcon, true);
        assert.equal(await tab.evaluate(`document.documentElement.scrollWidth <= innerWidth`), true, `no horizontal scroll ${mode} ${width}`);
        await capture(tab, `links-${mode}-${width}`);
      }
    } finally { await tab.close(); }
  });
}

it('링크 카드 반응: tapping a chip changes counts at once through the existing reaction API (one request), and takes the own one back', async () => {
  const tab = await openFixture(`${origin}/invitation-test-harness?fixturePage=links&mode=grid&fixtureCount=0`);
  try {
    await tab.until(`document.querySelectorAll('[data-card-reactions]').length === 2`);
    // Clicks only count after hydration (the server HTML is already there before React listens).
    await tab.until(`Object.keys(document.querySelector('[data-reaction]')).some(key => key.startsWith('__reactProps'))`);
    const chip = (card, key) => `([...document.querySelectorAll('ul > li')].find(li => li.textContent.includes('${card}')).querySelector('[data-reaction="${key}"]'))`;
    const count = (card, key) => `(${chip(card, key)}?.textContent.replace(/\\s/g, '') ?? '')`;
    assert.match(await tab.evaluate(count('반응 하나', 'heart')), /1$/);
    // Someone else's reaction -> mine: the chip counts up at once and the request is the existing PUT.
    await tab.evaluate(`${chip('반응 하나', 'heart')}.click()`);
    await tab.until(`${count('반응 하나', 'heart')}.endsWith('2')`);
    await tab.until(`JSON.parse(sessionStorage.getItem('invitationCalls')).includes('PUT /api/v1/collections/10/items/2/reaction')`);
    // The server's answer settles first (a tap while one is on its way is ignored - one request at a time); then my own again: taken back (DELETE).
    await tab.wait(600);
    await tab.evaluate(`${chip('반응 하나', 'heart')}.click()`);
    await tab.until(`${count('반응 하나', 'heart')}.endsWith('1')`);
    await tab.until(`JSON.parse(sessionStorage.getItem('invitationCalls')).includes('DELETE /api/v1/collections/10/items/2/reaction')`);
    const calls = JSON.parse(await tab.evaluate(`sessionStorage.getItem('invitationCalls')`)).filter(call => call.includes('/reaction'));
    assert.deepEqual(calls, ['PUT /api/v1/collections/10/items/2/reaction', 'DELETE /api/v1/collections/10/items/2/reaction']);
    // No per-card read of the links: the list row already carries the reactions (no N+1).
    assert.equal(JSON.parse(await tab.evaluate(`sessionStorage.getItem('invitationCalls')`)).some(call => /\/items\/\d+$/.test(call)), false);
  } finally { await tab.close(); }
});

it('자동 갱신: a friend request and a notification that arrive while the page stays open reach the bell, the 친구 menu and the open list on their own - measured', async () => {
  const tab = await openFixture(`${origin}/invitation-test-harness?fixturePage=friends&fixtureCount=0&fixtureFriends=1&fixtureLiveAfterMs=4000`);
  try {
    await tab.until(`(${navCount('/me/friends')}) === '1'`);
    const bell = `(document.querySelector('button[aria-label^="알림"]')?.textContent.trim() ?? '')`;
    const liveAt = Number(await tab.evaluate(`sessionStorage.getItem('liveAt')`));
    await tab.until(`(${navCount('/me/friends')}) === '2'`, 120_000);
    const elapsedMs = Date.now() - liveAt;
    await tab.until(`${bell} !== ''`, 10_000);
    // The already open 친구 list shows the new request too (its tab count), not only the menu.
    await tab.until(`[...document.querySelectorAll('[role="tab"]')].some(el => el.textContent.includes('받은') && el.textContent.includes('2'))`, 10_000);
    console.log(`# automatic refresh: the arrival reached the screen ${(elapsedMs / 1000).toFixed(1)} s after it happened (poll every 60 s)`);
    assert.ok(elapsedMs <= 75_000, `the arrival reached the screen within one poll interval (took ${elapsedMs} ms)`);
  } finally { await tab.close(); }
});

it('받은 승인 요청 컬렉션 목록: name and red count share one vertical center, the count ends on the header X line, long names ellipsize - 0 / 1 / several', async () => {
  const tab = await openFixture(`${origin}/invitation-test-harness?tab=shared&fixtureCount=0&fixtureAttention=1&fixtureOwnerCollections=3`);
  try {
    await tab.until(`!!${requestRow('received-approvals')}`);
    for (const width of [1280, 393, 320]) {
      await tab.send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: width < 600 });
      await tab.evaluate(`document.fonts.ready.then(() => new Promise(resolve => requestAnimationFrame(resolve)))`);
      await tab.evaluate(`${requestRow('received-approvals')}.click()`);
      await tab.until(`document.querySelectorAll('[data-request-collection]').length === 4`);
      const m = await tab.evaluate(`(() => {
        const dialog = document.querySelector('dialog[open]'), x = dialog.querySelector('button[aria-label="닫기"]').getBoundingClientRect(), panel = dialog.getBoundingClientRect();
        return {
          panelRight: Math.round(panel.right), xRight: Math.round(x.right),
          rows: [...dialog.querySelectorAll('[data-request-collection]')].map(row => {
            const r = row.getBoundingClientRect(), name = row.querySelector('span:nth-of-type(2)').getBoundingClientRect(), badge = row.querySelector('[data-attention-badge]').getBoundingClientRect(), tile = row.querySelector('span').getBoundingClientRect();
            const nameEl = row.querySelector('span:nth-of-type(2)');
            return { badgeRight: Math.round(badge.right), centerGap: Math.round(Math.abs((name.top + name.bottom) / 2 - (badge.top + badge.bottom) / 2) * 10) / 10, tileGap: Math.round(Math.abs((tile.top + tile.bottom) / 2 - (badge.top + badge.bottom) / 2) * 10) / 10, oneLine: name.height < 30, ellipsis: nameEl.scrollWidth > nameEl.clientWidth, badgeInside: badge.right <= r.right && badge.left >= name.right - 0.5, nameText: nameEl.textContent.slice(0, 6) };
          }),
          overflowX: dialog.scrollWidth > dialog.clientWidth,
        };
      })()`);
      assert.equal(m.overflowX, false, `no horizontal overflow ${width}`);
      for (const row of m.rows) {
        assert.ok(row.centerGap < 1 && row.tileGap < 1, `name, icon and count share one vertical center ${width}: ${JSON.stringify(row)}`);
        assert.ok(row.oneLine && row.badgeInside, `one line, count after the name ${width}`);
        assert.ok(Math.abs(row.badgeRight - m.xRight) <= 1, `the count ends on the header X line ${width}: ${row.badgeRight} vs ${m.xRight}`);
      }
      assert.equal(m.rows.filter(row => row.ellipsis).length, 1, `only the long name ellipsizes ${width}`);
      await capture(tab, `picker-${width}`);
      await tab.evaluate(`document.querySelector('dialog[open] button[aria-label="닫기"]').click()`);
      await tab.until(`!document.querySelector('dialog[open]')`);
    }
  } finally { await tab.close(); }
});

it('받은 초대 요청: the Owner is the avatar with Juple\'s crown and the name - no "소유자" word - and nothing overlaps at 1280 / 393 / 320', async () => {
  const tab = await openFixture(`${origin}/invitation-test-harness?tab=shared&fixtureCount=2`);
  try {
    await tab.until(`!!${entry}`);
    await tab.evaluate(`${entry}.click()`);
    await tab.until(`document.querySelectorAll('[data-invitation-owner]').length === 2`);
    for (const width of [1280, 393, 320]) {
      await tab.send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: width < 600 });
      await tab.evaluate(`document.fonts.ready.then(() => new Promise(resolve => requestAnimationFrame(resolve)))`);
      const g = await tab.evaluate(`(() => { const o = document.querySelector('[data-invitation-owner]'); const name = o.lastElementChild; const c = o.querySelector('[data-owner-crown] svg').getBoundingClientRect(), n = name.getBoundingClientRect(), av = o.querySelector('[data-owner-crown] > span').getBoundingClientRect();
        return { text: o.textContent.trim(), hasCrown: !!o.querySelector('[data-owner-crown] svg'), crownOnAvatar: c.left < av.right + 8 && c.right > av.left, crownClearOfName: c.right <= n.left + 1, label: o.getAttribute('aria-label') }; })()`);
      assert.equal(g.text.includes('소유자'), false, `no owner word on the card ${width}: ${g.text}`);
      assert.equal(g.hasCrown && g.crownOnAvatar && g.crownClearOfName, true, `crown beside the avatar, clear of the name ${width}: ${JSON.stringify(g)}`);
      assert.ok(g.label.includes('소유자'), 'assistive technology still hears the role');
      await capture(tab, `invitation-owner-${width}`);
    }
  } finally { await tab.close(); }
});
