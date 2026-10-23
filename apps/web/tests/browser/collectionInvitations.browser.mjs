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

it('받은 승인 요청: a shared-tab row with the red count at its end opens the real list; approve / reject update the row and the menu number', async () => {
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
        return { inside: b.left >= r.left && b.right <= r.right && b.top >= r.top && b.bottom <= r.bottom, apart: Math.abs(b.right - c.left) >= 0 && (b.right <= c.left + 0.5 || c.right <= b.left + 0.5), noOverflow: document.documentElement.scrollWidth <= innerWidth };
      })()`);
      assert.deepEqual(fit, { inside: true, apart: true, noOverflow: true }, `request row ${width}`);
      await capture(tab, `requests-${width}`);
    }
    await tab.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
    await tab.evaluate(`${requestRow('received-approvals')}.click()`);
    await tab.until(`document.querySelectorAll('[data-submission-id]').length === 2`);
    assert.equal(await tab.evaluate(`document.querySelector('dialog[open]').textContent.includes('Proposer')`), true, 'who proposed');
    await capture(tab, 'requests-dialog');
    // Approve the first: one call, the row leaves, the numbers follow.
    await tab.evaluate(`document.querySelector('[data-submission-id="1"] button:last-of-type').click()`);
    await tab.until(`document.querySelectorAll('[data-submission-id]').length === 1`);
    await tab.until(`(${navCount('/collections')}) === '1'`);
    // Reject the second after the confirmation.
    await tab.evaluate(`document.querySelector('[data-submission-id="2"] button:first-of-type').click()`);
    await tab.until(`!![...document.querySelectorAll('dialog[open] button')].find(el => el.textContent === '거절' && el.closest('dialog').querySelector('h2')?.textContent.includes('거절할까요'))`);
    await tab.evaluate(`[...document.querySelectorAll('dialog[open] button')].find(el => el.textContent === '거절' && el.closest('dialog').querySelector('h2')?.textContent.includes('거절할까요')).click()`);
    await tab.until(`document.querySelectorAll('[data-submission-id]').length === 0`);
    const calls = JSON.parse(await tab.evaluate(`sessionStorage.getItem('invitationCalls')`));
    assert.equal(calls.filter(call => call === 'POST /api/v1/collections/10/submissions/1/approve').length, 1);
    assert.equal(calls.filter(call => call === 'DELETE /api/v1/collections/10/submissions/2').length, 1);
    await tab.evaluate(`document.querySelector('dialog[open] button[aria-label="닫기"]').click()`);
    await tab.until(`!${requestRow('received-approvals')}`);
    assert.equal(await tab.evaluate(typeCount('shared')), '0');
  } finally { await tab.close(); }
});

it('보낸 승인 요청: the sent row lists only my own waiting links and 요청 취소 lowers its number', async () => {
  const tab = await openFixture(`${origin}/invitation-test-harness?tab=shared&fixtureCount=0&fixtureMine=2&fixtureAttention=1`);
  await tab.send('Emulation.setDeviceMetricsOverride', { width: 393, height: 900, deviceScaleFactor: 1, mobile: true });
  try {
    await tab.until(`!!${requestRow('sent-approvals')}`);
    assert.equal(await tab.evaluate(`${requestRow('sent-approvals')}.textContent.trim()`), '보낸 승인 요청대기 2건');
    assert.equal(await tab.evaluate(`${requestRow('sent-approvals')}.querySelector('[data-attention-badge]')`), null, 'a status row has no badge');
    assert.equal(await tab.evaluate(`${requestRow('sent-approvals')}.dataset.requestVariant`), 'status');
    await capture(tab, 'sent-and-received-393');
    await tab.evaluate(`${requestRow('sent-approvals')}.click()`);
    await tab.until(`document.querySelectorAll('[data-my-submission-id]').length === 2`);
    await tab.evaluate(`document.querySelector('[data-my-submission-id="900"] button').click()`);
    await tab.until(`!![...document.querySelectorAll('dialog[open] button')].find(el => el.textContent === '요청 취소' && el.closest('dialog').querySelector('h2')?.textContent.includes('취소할까요'))`);
    await tab.evaluate(`[...document.querySelectorAll('dialog[open] button')].find(el => el.textContent === '요청 취소' && el.closest('dialog').querySelector('h2')?.textContent.includes('취소할까요')).click()`);
    await tab.until(`document.querySelectorAll('[data-my-submission-id]').length === 1`);
    await tab.evaluate(`document.querySelector('dialog[open] button[aria-label="닫기"]').click()`);
    await tab.until(`${requestRow('sent-approvals')}?.textContent.trim() === '보낸 승인 요청대기 1건'`);
  } finally { await tab.close(); }
});
