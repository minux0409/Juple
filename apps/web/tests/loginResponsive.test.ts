import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { pathToFileURL } from 'node:url';

const css = readFileSync(new URL('../app/(app)/app.module.css', import.meta.url), 'utf8');
const browsers = [
  process.env.CHROME_BIN ?? '',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
].filter(candidate => candidate && existsSync(candidate));

interface LayoutMeasurement {
  readonly viewport: number;
  readonly viewportHeight: number;
  readonly scrollWidth: number;
  readonly buttonBottom: number;
  readonly brandLeft: number;
  readonly cardLeft: number;
  readonly cardTop: number;
  readonly brandTop: number;
}

const delay = (milliseconds: number) => new Promise(resolve => setTimeout(resolve, milliseconds));

async function measure(width: number, height: number): Promise<LayoutMeasurement> {
  const dir = mkdtempSync(path.join(tmpdir(), 'juple-login-'));
  const file = path.join(dir, 'login.html');
  const markup = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><style>
    :root{--app-background:#f8f8fb;--app-surface:#fff;--app-border:#e6e6eb;--app-text:#222;--app-text-secondary:#686873;--brand-gradient:linear-gradient(90deg,#ff6a5c,#f2389a,#6a5cff)}
    *{box-sizing:border-box}body{margin:0;font-family:Arial,sans-serif}${css}
  </style></head><body><main class="signInPage"><div class="signInLayout">
    <section class="signInBrandPanel"><div class="brandLockup"><span style="width:58px;height:58px"></span><span class="brandWordmark">Juple</span></div><h1 class="signInHeadline">발견한 것들을 모아두고,<br>나중에 다시 꺼내보세요.</h1><p class="signInSupporting">링크를 저장하고, 컬렉션으로 정리하고, 필요할 때 다시 찾아보세요.</p><ul class="signInFeatures"><li>링크 저장</li><li>컬렉션 정리</li><li>공유·협업</li></ul></section>
    <section class="signInCard"><div class="signInCardLockup">Juple</div><h2 class="signInTitle">Juple 시작하기</h2><p class="signInDescription">로그인하거나 새 계정을 만들어 저장한 링크를 어디서든 이어보세요.</p><button class="signInButton">로그인 / 회원가입</button><p class="authProviderNote">로그인은 안전한 Microsoft 인증 화면에서 진행됩니다.</p></section>
    <footer class="signInFooter"><nav><a>개인정보처리방침</a><a>이용약관</a><a>계정 삭제 안내</a><button>사업자 정보</button></nav></footer>
  </div></main><script>addEventListener('load',()=>{const r=s=>document.querySelector(s).getBoundingClientRect();const v={viewport:innerWidth,viewportHeight:innerHeight,scrollWidth:document.documentElement.scrollWidth,buttonBottom:r('.signInButton').bottom,brandLeft:r('.signInBrandPanel').left,cardLeft:r('.signInCard').left,cardTop:r('.signInCard').top,brandTop:r('.signInBrandPanel').top};document.title=JSON.stringify(v)})</script></body></html>`;
  writeFileSync(file, markup);
  const profile = path.join(dir, 'profile');
  const chrome = spawn(browsers[0], ['--headless=new', '--disable-gpu', '--no-first-run', '--remote-debugging-port=0', `--user-data-dir=${profile}`, pathToFileURL(file).href], { stdio: 'ignore' });
  try {
    const portFile = path.join(profile, 'DevToolsActivePort');
    for (let attempt = 0; attempt < 100 && !existsSync(portFile); attempt += 1) await delay(50);
    assert.ok(existsSync(portFile), 'Chrome did not publish its DevTools port');
    const port = Number(readFileSync(portFile, 'utf8').split(/\r?\n/, 1)[0]);
    const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json() as Array<{ type: string; url: string; webSocketDebuggerUrl: string }>;
    const target = targets.find(candidate => candidate.type === 'page' && candidate.url.includes('login.html'));
    assert.ok(target);
    const socket = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise<void>((resolve, reject) => {
      socket.addEventListener('open', () => resolve(), { once: true });
      socket.addEventListener('error', () => reject(new Error('Chrome DevTools WebSocket failed')), { once: true });
    });
    let nextId = 0;
    const pending = new Map<number, (value: unknown) => void>();
    socket.addEventListener('message', event => {
      const message = JSON.parse(String(event.data)) as { id?: number; result?: unknown; error?: unknown };
      if (message.id !== undefined) pending.get(message.id)?.(message.error ? { error: message.error } : message.result);
    });
    const send = (method: string, params: Record<string, unknown> = {}) => new Promise<unknown>(resolve => {
      const id = ++nextId;
      pending.set(id, resolve);
      socket.send(JSON.stringify({ id, method, params }));
    });
    const waitUntilReady = async () => {
      for (let attempt = 0; attempt < 50; attempt += 1) {
        const ready = await send('Runtime.evaluate', { returnByValue: true, expression: 'document.readyState' }) as { result?: { value?: string } };
        if (ready.result?.value === 'complete') return;
        await delay(50);
      }
      assert.fail('Chrome page did not finish loading');
    };
    await waitUntilReady();
    await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
    await waitUntilReady();
    let evaluated: { result?: { value?: LayoutMeasurement } } = {};
    for (let attempt = 0; attempt < 20 && !evaluated.result?.value; attempt += 1) {
      evaluated = await send('Runtime.evaluate', {
        awaitPromise: true,
        returnByValue: true,
        expression: `new Promise(resolve => requestAnimationFrame(() => { const r=s=>document.querySelector(s).getBoundingClientRect(); resolve({viewport:innerWidth,viewportHeight:innerHeight,scrollWidth:document.documentElement.scrollWidth,buttonBottom:r('.signInButton').bottom,brandLeft:r('.signInBrandPanel').left,cardLeft:r('.signInCard').left,cardTop:r('.signInCard').top,brandTop:r('.signInBrandPanel').top}) }))`,
      }) as { result?: { value?: LayoutMeasurement } };
      if (!evaluated.result?.value) await delay(50);
    }
    socket.close();
    assert.ok(evaluated.result?.value, JSON.stringify(evaluated));
    return evaluated.result.value;
  } finally {
    chrome.kill();
  }
}

describe('login layout in a real browser', { skip: browsers.length === 0 ? 'no Chrome / Edge found' : false }, () => {
  for (const [width, height] of [[390, 650], [430, 760], [768, 900], [1440, 900]] as const) {
    it(`${width}px has no horizontal overflow and keeps the primary action reachable`, async () => {
      const result = await measure(width, height);
      assert.equal(result.viewport, width, JSON.stringify(result));
      assert.ok(result.scrollWidth <= result.viewport, JSON.stringify(result));
      assert.ok(result.buttonBottom <= result.viewportHeight + 80, JSON.stringify(result));
      if (width >= 1000) assert.ok(result.cardLeft > result.brandLeft, JSON.stringify(result));
      else assert.ok(result.cardTop > result.brandTop, JSON.stringify(result));
    });
  }
});
