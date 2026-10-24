import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmdirSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { fileURLToPath } from 'node:url';
import { before, after, it } from 'node:test';
import { findChrome, openPage } from '../../../web/tests/browser/cdp.mjs';
const root = fileURLToPath(new URL('../../', import.meta.url)),
  harness = `${root}app/notice-test-harness`,
  origin = 'http://localhost:3195';
let server,
  owned = false,
  port = 9940;
before(async () => {
  assert.ok(findChrome());
  assert.equal(existsSync(harness), false);
  mkdirSync(harness);
  owned = true;
  copyFileSync(`${root}tests/browser/page.tsx.tpl`, `${harness}/page.tsx`);
  copyFileSync(`${root}tests/browser/adapter.ts.tpl`, `${harness}/adapter.ts`);
  for (const [source, name] of [
    ['app/(admin)/notices/NoticeEditor.tsx', 'NoticeEditor.tsx'],
    ['app/(admin)/notices/page.tsx', 'NoticeList.tsx'],
    ['app/(admin)/usePagedList.ts', 'usePagedList.ts'],
  ]) {
    let code = readFileSync(`${root}${source}`, 'utf8')
      .replaceAll("from '../AdminRoot'", "from './adapter'")
      .replaceAll("from './AdminRoot'", "from './adapter'")
      .replaceAll("from '../usePagedList'", "from './usePagedList'")
      .replaceAll("from '../../../lib/", "from '../../lib/");
    if (name === 'NoticeEditor.tsx')
      code = code.replace("from 'next/navigation'", "from './adapter'");
    writeFileSync(`${harness}/${name}`, code);
  }
  server = spawn(
    process.execPath,
    [`${root}node_modules/next/dist/bin/next`, 'dev', '-p', '3195'],
    {
      cwd: root,
      stdio: 'ignore',
      env: { ...process.env, NEXT_TELEMETRY_DISABLED: '1' },
    },
  );
  for (let i = 0; i < 90; i++) {
    try {
      if ((await fetch(`${origin}/notice-test-harness`)).status === 200) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error('Admin mock startup timeout');
});
after(async () => {
  if (owned) {
    for (const name of [
      'page.tsx',
      'adapter.ts',
      'NoticeEditor.tsx',
      'NoticeList.tsx',
      'usePagedList.ts',
    ])
      unlinkSync(`${harness}/${name}`);
    rmdirSync(harness);
    for (let i = 0; i < 30; i++) {
      const f = `${root}.next/dev/types/validator.ts`;
      if (
        !existsSync(f) ||
        !readFileSync(f, 'utf8').includes('notice-test-harness')
      )
        break;
      await new Promise((r) => setTimeout(r, 300));
    }
  }
  if (server)
    await new Promise((r) =>
      spawn('taskkill', ['/PID', String(server.pid), '/T', '/F'], {
        stdio: 'ignore',
      }).on('close', r),
    );
});
const open = (url) => openPage(findChrome(), url, port++);
const fillKorean = async (tab) => {
  await tab.until(
    `document.documentElement.dataset.noticeFixtureReady==='1'&&!!document.querySelector('textarea')`,
  );
  await tab.evaluate(
    `document.querySelector('input[maxlength="200"]').focus()`,
  );
  await tab.send('Input.insertText', { text: '입력 유지 공지' });
  await tab.evaluate(`document.querySelector('textarea').focus()`);
  await tab.send('Input.insertText', { text: '입력한 본문 유지' });
};
it('validation is visible next to Save without sending a request', async () => {
  const tab = await open(`${origin}/notice-test-harness?new=1`);
  try {
    await tab.until(
      `document.documentElement.dataset.noticeFixtureReady==='1'&&!!document.querySelector('textarea')`,
    );
    await tab.evaluate(
      `document.querySelector('button[type="submit"]').click()`,
    );
    await tab.until(
      `document.querySelector('[role="alert"]')?.textContent.includes('한국어')`,
    );
    assert.equal(
      await tab.evaluate(
        `JSON.parse(sessionStorage.getItem('adminNoticeCalls')??'[]').some(x=>x.method==='POST')`,
      ),
      false,
    );
    assert.equal(
      await tab.evaluate(
        `(()=>{const r=document.querySelector('[role="alert"]').getBoundingClientRect();return r.top>=0&&r.bottom<=innerHeight;})()`,
      ),
      true,
    );
  } finally {
    await tab.close();
  }
});
for (const status of [400, 409, 500])
  it(`save HTTP ${status} keeps inputs and visibly reports failure`, async () => {
    const tab = await open(
      `${origin}/notice-test-harness?new=1&failSave=${status}`,
    );
    try {
      await fillKorean(tab);
      await tab.evaluate(
        `document.querySelector('button[type="submit"]').click()`,
      );
      await tab.until(
        `document.querySelector('[role="alert"]')?.textContent.includes('HTTP ${status}')`,
      );
      assert.equal(
        await tab.evaluate(`document.querySelector('textarea').value`),
        '입력한 본문 유지',
      );
      assert.equal(
        await tab.evaluate(
          `document.querySelector('input[maxlength="200"]').value`,
        ),
        '입력 유지 공지',
      );
      assert.equal(
        await tab.evaluate(`sessionStorage.getItem('adminNoticeNavigation')`),
        null,
      );
      assert.equal(
        await tab.evaluate(
          `document.querySelector('button[type="submit"]').disabled`,
        ),
        false,
      );
    } finally {
      await tab.close();
    }
  });
it('save blocks duplicate requests and confirms success with a refreshed list', async () => {
  const tab = await open(`${origin}/notice-test-harness?new=1&slowSave=1`);
  try {
    await fillKorean(tab);
    await tab.evaluate(
      `(()=>{const b=document.querySelector('button[type="submit"]');b.click();b.click();})()`,
    );
    await tab.until(
      `document.querySelector('button[type="submit"]').textContent.includes('저장 중')`,
    );
    await tab.until(`sessionStorage.getItem('adminNoticeRefreshed')==='1'`);
    assert.equal(
      await tab.evaluate(
        `JSON.parse(sessionStorage.getItem('adminNoticeCalls')).filter(x=>x.method==='POST').length`,
      ),
      1,
    );
    await tab.send('Page.navigate', {
      url: `${origin}/notice-test-harness?list=1&saved=9`,
    });
    await tab.until(
      `document.querySelector('[role="status"]')?.textContent.includes('공지를 저장했습니다.')`,
    );
  } finally {
    await tab.close();
  }
});
it('admin creates Korean/English notice, explicit platforms and schedule without resetting reads', async () => {
  const tab = await open(`${origin}/notice-test-harness?new=1`);
  try {
    await tab.until(
      `document.documentElement.dataset.noticeFixtureReady==='1'&&!!document.querySelector('textarea')`,
    );
    await tab.evaluate(
      `document.querySelector('input[maxlength="200"]').focus()`,
    );
    await tab.send('Input.insertText', { text: '새 공지' });
    await tab.evaluate(`document.querySelector('textarea').focus()`);
    await tab.send('Input.insertText', { text: '안전한 본문' });
    await tab.evaluate(
      `(()=>{const s=document.querySelectorAll('select')[1];s.value='en';s.dispatchEvent(new Event('change',{bubbles:true}));})()`,
    );
    await tab.until(`document.querySelector('textarea').value===''`);
    await tab.evaluate(
      `document.querySelector('input[maxlength="200"]').focus()`,
    );
    await tab.send('Input.insertText', { text: 'English notice' });
    await tab.evaluate(`document.querySelector('textarea').focus()`);
    await tab.send('Input.insertText', { text: 'English body' });
    await tab.evaluate(
      `(()=>{const s=document.querySelectorAll('select')[1];s.value='ko';s.dispatchEvent(new Event('change',{bubbles:true}));})()`,
    );
    await tab.until(
      `document.querySelector('input[maxlength="200"]').value==='새 공지'`,
    );
    await tab.evaluate(
      `(()=>{const s=document.querySelector('select');s.value='Published';s.dispatchEvent(new Event('change',{bubbles:true}));})()`,
    );
    assert.equal(
      await tab.evaluate(
        `document.querySelectorAll('select')[1].options.length`,
      ),
      17,
    );
    await tab.evaluate(
      `document.querySelector('button[type="submit"]').click()`,
    );
    await tab.until(
      `sessionStorage.getItem('adminNoticeNavigation')==='/notices?saved=9'&&sessionStorage.getItem('adminNoticeRefreshed')==='1'`,
    );
    const call = await tab.evaluate(
      `JSON.parse(sessionStorage.getItem('adminNoticeCalls')).find(x=>x.method==='POST')`,
    );
    assert.equal(call.body.status, 'Published');
    assert.equal(call.body.platforms, 7);
    assert.equal(call.body.translations[0].language, 'ko');
    assert.equal(
      call.body.translations.find((x) => x.language === 'en').title,
      'English notice',
    );
    assert.equal(call.body.resetRead, false);
    assert.ok(call.body.startsAtUtc.endsWith('Z'));
  } finally {
    await tab.close();
  }
});
for (const width of [1280, 393, 320])
  it(`admin edit, stop and confirmed soft-delete payload at ${width}px`, async () => {
    const tab = await open(`${origin}/notice-test-harness`);
    try {
      await tab.send('Emulation.setDeviceMetricsOverride', {
        width,
        height: 850,
        deviceScaleFactor: 1,
        mobile: false,
      });
      await tab.until(
        `document.querySelector('input[maxlength="200"]')?.value==='운영 공지'`,
      );
      assert.equal(
        await tab.evaluate(`document.documentElement.scrollWidth<=innerWidth`),
        true,
      );
      await tab.evaluate(
        `window.confirm=()=>true;[...document.querySelectorAll('button')].find(b=>b.textContent==='게시 중단').click()`,
      );
      await tab.until(
        `JSON.parse(sessionStorage.getItem('adminNoticeCalls')).some(x=>x.method==='PUT')`,
      );
      assert.equal(
        await tab.evaluate(
          `JSON.parse(sessionStorage.getItem('adminNoticeCalls')).find(x=>x.method==='PUT').body.status`,
        ),
        'Draft',
      );
      await tab.evaluate(
        `window.confirm=()=>false;[...document.querySelectorAll('button')].find(b=>b.textContent==='삭제').click()`,
      );
      assert.equal(
        await tab.evaluate(`sessionStorage.getItem('noticeDeleted')`),
        null,
      );
      await tab.evaluate(
        `window.confirm=()=>true;[...document.querySelectorAll('button')].find(b=>b.textContent==='삭제').click()`,
      );
      await tab.until(`sessionStorage.getItem('noticeDeleted')==='1'`);
    } finally {
      await tab.close();
    }
  });
it('admin title search and publication filter use server query parameters', async () => {
  const tab = await open(`${origin}/notice-test-harness?list=1`);
  try {
    await tab.until(`!!document.querySelector('tbody a')`);
    await tab.evaluate(`document.querySelector('input').focus()`);
    await tab.send('Input.insertText', { text: '찾을 수 없는 제목' });
    await tab.evaluate(
      `document.querySelector('form button[type="submit"]').click()`,
    );
    await tab.until(`document.querySelector('tbody').children.length===0`);
    await tab.evaluate(
      `(()=>{const s=document.querySelector('select');s.value='Draft';s.dispatchEvent(new Event('change',{bubbles:true}));})()`,
    );
    await tab.until(
      `JSON.parse(sessionStorage.getItem('adminNoticeCalls')).some(x=>x.path.includes('status=Draft'))`,
    );
  } finally {
    await tab.close();
  }
});
