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
import { findChrome, openPage } from './cdp.mjs';
const root = fileURLToPath(new URL('../../', import.meta.url)),
  harness = `${root}app/notice-test-harness`,
  origin = 'http://localhost:3196';
let server,
  owned = false,
  port = 9840;
before(async () => {
  assert.ok(findChrome());
  assert.equal(existsSync(harness), false);
  mkdirSync(harness);
  owned = true;
  copyFileSync(
    `${root}tests/browser/harness/notices.page.tsx.tpl`,
    `${harness}/page.tsx`,
  );
  server = spawn(
    process.execPath,
    [`${root}node_modules/next/dist/bin/next`, 'dev', '-p', '3196'],
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
  throw new Error('Mock server timeout');
});
after(async () => {
  if (owned) {
    unlinkSync(`${harness}/page.tsx`);
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
for (const width of [1280, 393, 320])
  for (const theme of ['light', 'dark'])
    it(`notices list, pagination, safe detail/read sync at ${width}px ${theme}`, async () => {
      const tab = await openPage(
        findChrome(),
        `${origin}/notice-test-harness?theme=${theme}`,
        port++,
      );
      try {
        await tab.send('Emulation.setDeviceMetricsOverride', {
          width,
          height: 850,
          deviceScaleFactor: 1,
          mobile: false,
        });
        await tab.until(
          `document.querySelectorAll('a[href="/me/notices/1"]').length===1&&document.querySelector('[data-badge]').textContent==='N'`,
        );
        await tab.until(`document.documentElement.dataset.theme==='${theme}'`);
        assert.equal(
          await tab.evaluate(
            `document.documentElement.scrollWidth<=innerWidth`,
          ),
          true,
        );
        await tab.evaluate(
          `[...document.querySelectorAll('button')].find(b=>b.textContent==='더 보기').click()`,
        );
        await tab.until(`!!document.querySelector('a[href="/me/notices/2"]')`);
        await tab.send('Page.navigate', {
          url: `${origin}/notice-test-harness?detail=1&theme=${theme}`,
        });
        await tab.until(
          `document.querySelector('article')?.textContent.includes('<script>')&&document.querySelector('[data-badge]').textContent===''`,
        );
        await tab.until(`document.documentElement.dataset.theme==='${theme}'`);
        assert.equal(await tab.evaluate(`window.noticeXss===undefined`), true);
        assert.equal(
          await tab.evaluate(`document.querySelector('article a').href`),
          'https://juple.co.kr/help',
        );
        assert.equal(
          await tab.evaluate(
            `document.documentElement.scrollWidth<=innerWidth`,
          ),
          true,
        );
        if (process.env.NOTICE_SCREENSHOT_DIR) {
          mkdirSync(process.env.NOTICE_SCREENSHOT_DIR, { recursive: true });
          const shot = await tab.send('Page.captureScreenshot', {
            format: 'png',
          });
          writeFileSync(
            `${process.env.NOTICE_SCREENSHOT_DIR}/notice-${width}-${theme}.png`,
            Buffer.from(shot.result.data, 'base64'),
          );
        }
        await tab.send('Page.navigate', {
          url: `${origin}/notice-test-harness?theme=${theme}`,
        });
        await tab.until(
          `document.querySelector('a[href="/me/notices/1"]')?.textContent.includes('읽음')&&document.querySelector('[data-badge]').textContent===''`,
        );
      } finally {
        await tab.close();
      }
    });
it('read failure preserves unread N and explains retry', async () => {
  const tab = await openPage(
    findChrome(),
    `${origin}/notice-test-harness?detail=1&failRead=1`,
    port++,
  );
  try {
    await tab.until(
      `document.querySelector('article [role="alert"]')?.textContent.includes('읽음 상태')`,
    );
    assert.equal(
      await tab.evaluate(`document.querySelector('[data-badge]').textContent`),
      'N',
    );
  } finally {
    await tab.close();
  }
});

it('a withdrawn/deleted notice disappears from an already open detail on authoritative refresh', async () => {
  const tab = await openPage(
    findChrome(),
    `${origin}/notice-test-harness?detail=1`,
    port++,
  );
  try {
    await tab.until(`!!document.querySelector('article')`);
    await tab.evaluate(
      `sessionStorage.setItem('noticeDeleted','1');window.dispatchEvent(new Event('focus'))`,
    );
    await tab.until(`!document.querySelector('article')`);
  } finally {
    await tab.close();
  }
});
