// A minimal Chrome DevTools Protocol driver (no dependency): launches a headless Chrome with a throwaway profile and one tab.
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export function findChrome() {
  const candidates = [
    process.env.CHROME_PATH,
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    '/usr/bin/google-chrome',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  ];
  return candidates.find(path => path && existsSync(path)) ?? null;
}

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

/** Every page opened and not yet closed: a test that fails while it is being set up never reaches its own finally, and a leaked Chrome keeps Node alive. */
const livePages = new Set();

/** Closes whatever is still open (call from after()) - nothing is force-killed: each page closes its own socket and browser. */
export async function closeAllPages() {
  for (const page of [...livePages]) {
    await page.close();
  }
}

/** Starts Chrome and connects to a new tab; a Chrome that never exposes its debugging port is killed and its profile removed before the error leaves (nothing is leaked). */
async function launch(chrome, url, port) {
  const profile = mkdtempSync(join(tmpdir(), 'juple-chrome-'));
  const browser = spawn(
    chrome,
    ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, '--no-first-run', '--disable-extensions', 'about:blank'],
    { stdio: 'ignore' },
  );
  let socket;
  for (let attempt = 0; attempt < 100 && !socket; attempt += 1) {
    try {
      const tab = await (await fetch(`http://127.0.0.1:${port}/json/new?${encodeURIComponent(url)}`, { method: 'PUT' })).json();
      socket = new WebSocket(tab.webSocketDebuggerUrl);
    } catch {
      await wait(200);
    }
  }
  if (!socket) {
    browser.kill();
    await wait(300);
    try {
      rmSync(profile, { recursive: true, force: true });
    } catch {
      // The profile is a temp dir; Windows may still hold it for a moment.
    }
    throw new Error(`Chrome did not expose its debugging port ${port}`);
  }
  return { browser, socket, profile };
}

export async function openPage(chrome, url, port) {
  let started;
  try {
    started = await launch(chrome, url, port);
  } catch {
    // A slow machine: once more, on a fresh port.
    started = await launch(chrome, url, port + 5000);
  }
  const { browser, socket, profile } = started;
  await new Promise(resolve => socket.addEventListener('open', resolve));
  let nextId = 0;
  const pending = new Map();
  const listeners = [];
  socket.addEventListener('message', message => {
    const data = JSON.parse(message.data);
    if (data.id && pending.has(data.id)) {
      pending.get(data.id)(data);
      pending.delete(data.id);
    } else if (data.method) {
      listeners.forEach(listener => listener(data));
    }
  });
  const send = (method, params = {}) =>
    new Promise(resolve => {
      nextId += 1;
      pending.set(nextId, resolve);
      socket.send(JSON.stringify({ id: nextId, method, params }));
    });
  const evaluate = async expression => {
    const answer = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (answer.result?.exceptionDetails) {
      throw new Error(`page script failed: ${answer.result.exceptionDetails.text}`);
    }
    return answer.result?.result?.value;
  };
  const until = async (expression, timeoutMs = 60_000) => {
    const started = Date.now();
    let lastError = null;
    while (Date.now() - started < timeoutMs) {
      try {
        if (await evaluate(expression)) return true;
      } catch (error) {
        // A page that is navigating / reloading destroys the execution context mid-call: that is a moment, not a failure - try again.
        lastError = error;
      }
      await wait(150);
    }
    throw new Error(`timed out waiting for: ${expression}${lastError ? ` (last error: ${lastError.message})` : ''}`);
  };
  const key = async (name, code, windowsVirtualKeyCode, text) => {
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key: name, code, windowsVirtualKeyCode, text });
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: name, code, windowsVirtualKeyCode });
  };
  const page = {
    send,
    evaluate,
    until,
    key,
    wait,
    onEvent: listener => listeners.push(listener),
    close: async () => {
      livePages.delete(page);
      socket.close();
      browser.kill();
      await wait(300);
      try {
        rmSync(profile, { recursive: true, force: true });
      } catch {
        // The profile is a temp dir; Windows may still hold it for a moment.
      }
    },
  };
  livePages.add(page);
  return page;
}
