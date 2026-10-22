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

export async function openPage(chrome, url, port) {
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
    while (Date.now() - started < timeoutMs) {
      if (await evaluate(expression)) return true;
      await wait(150);
    }
    throw new Error(`timed out waiting for: ${expression}`);
  };
  const key = async (name, code, windowsVirtualKeyCode, text) => {
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key: name, code, windowsVirtualKeyCode, text });
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: name, code, windowsVirtualKeyCode });
  };
  return {
    send,
    evaluate,
    until,
    key,
    wait,
    onEvent: listener => listeners.push(listener),
    close: async () => {
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
}
