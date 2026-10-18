import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { APP_LANGUAGES } from '../lib/appI18n.ts';
import { getAppDictionary } from '../lib/appDictionary.ts';
import {
  buildShortcutFile,
  collectionShortcutUrl,
  downloadShortcutFile,
  escapeXml,
  resolveShortcutFormat,
  sanitizeShortcutFileName,
  SHORTCUT_FALLBACK_NAME,
} from '../lib/desktopShortcut.ts';

const source = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const WINDOWS_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';
const MAC_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15';
const LINUX_UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/130.0 Safari/537.36';
const ANDROID_UA = 'Mozilla/5.0 (Linux; Android 14; SM-S911B) AppleWebKit/537.36 Chrome/130.0 Mobile Safari/537.36';
const IPHONE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1';
const IPAD_UA = 'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1';

describe('which shortcut file a browser gets', () => {
  it('Windows .url, macOS .webloc, Linux / unknown the .url fallback', () => {
    assert.equal(resolveShortcutFormat(WINDOWS_UA), 'url');
    assert.equal(resolveShortcutFormat(MAC_UA, 0), 'webloc');
    assert.equal(resolveShortcutFormat(LINUX_UA), 'url');
    assert.equal(resolveShortcutFormat('SomethingElse/1.0'), 'url');
    assert.equal(resolveShortcutFormat(null), 'url');
  });

  it('phones and tablets get none (Juple\'s phone Web sends people to the app), including an iPad asking for the desktop site', () => {
    assert.equal(resolveShortcutFormat(ANDROID_UA), null);
    assert.equal(resolveShortcutFormat(IPHONE_UA), null);
    assert.equal(resolveShortcutFormat(IPAD_UA), null);
    assert.equal(resolveShortcutFormat(MAC_UA, 5), null);
  });
});

describe('the address in the file', () => {
  it('is the Collection\'s own signed-in route on the current origin - no query, no hash, no token', () => {
    const url = collectionShortcutUrl('https://juple.co.kr', 42);
    assert.equal(url, 'https://juple.co.kr/collections/42');
    assert.equal(collectionShortcutUrl('https://juple.co.kr/', 7), 'https://juple.co.kr/collections/7');
    assert.doesNotMatch(url, /[?#]|token|session|publicId|\/c\//i);
  });

  it('is the real route of the app (the Collection page), not a share link', () => {
    assert.ok(source('app/(app)/collections/[collectionId]/page.tsx').length > 0);
    assert.match(source('lib/savedLinks.ts'), /export function collectionHref\(collectionId: number\): string \{\s*return `\/collections\/\$\{collectionId\}`;/);
  });
});

describe('Windows .url', () => {
  it('has the .url name, the standard section and only the URL, as UTF-8 text', async () => {
    const file = buildShortcutFile('url', 'https://juple.co.kr/collections/42', '여행');
    assert.equal(file.fileName, '여행.url');
    assert.equal(file.content, '[InternetShortcut]\r\nURL=https://juple.co.kr/collections/42\r\n');
    const blob = new Blob([file.content], { type: file.mimeType });
    assert.equal(await blob.text(), file.content);
    assert.equal(new TextDecoder('utf-8', { fatal: true }).decode(new Uint8Array(await blob.arrayBuffer())), file.content);
  });

  it('a line break smuggled into the address cannot write another line', () => {
    const file = buildShortcutFile('url', 'https://juple.co.kr/collections/1\r\nIconFile=C:\\evil.exe', 'x');
    assert.equal(file.content.split('\r\n').filter(line => line !== '').length, 2);
    assert.doesNotMatch(file.content, /\r\nIconFile/);
  });
});

describe('macOS .webloc', () => {
  it('is a valid property list with the URL, named .webloc', async () => {
    const file = buildShortcutFile('webloc', 'https://juple.co.kr/collections/42', '여행');
    assert.equal(file.fileName, '여행.webloc');
    assert.match(file.content, /^<\?xml version="1\.0" encoding="UTF-8"\?>\n<!DOCTYPE plist PUBLIC "-\/\/Apple\/\/DTD PLIST 1\.0\/\/EN" "http:\/\/www\.apple\.com\/DTDs\/PropertyList-1\.0\.dtd">\n<plist version="1\.0">\n<dict>\n\t<key>URL<\/key>\n\t<string>https:\/\/juple\.co\.kr\/collections\/42<\/string>\n<\/dict>\n<\/plist>\n$/);
    assert.equal(await new Blob([file.content]).text(), file.content);
  });

  it('escapes & < > " \' in the address, so the plist never becomes malformed', () => {
    const file = buildShortcutFile('webloc', 'https://x.test/a?b=1&c=<2>"3"\'4', 'n');
    assert.match(file.content, /<string>https:\/\/x\.test\/a\?b=1&amp;c=&lt;2&gt;&quot;3&quot;&apos;4<\/string>/);
    assert.equal(escapeXml('<a href="x">&</a>'), '&lt;a href=&quot;x&quot;&gt;&amp;&lt;/a&gt;');
    // Only the five XML entities appear after escaping: no stray & / < / > inside the value.
    const value = /<string>([^]*)<\/string>/.exec(file.content)![1];
    assert.doesNotMatch(value.replace(/&(amp|lt|gt|quot|apos);/g, ''), /[&<>"']/);
  });

  it('the Collection\'s name (even full of markup) never reaches the file body - it is only the file name', () => {
    const file = buildShortcutFile('webloc', 'https://juple.co.kr/collections/1', '<script>&"</script>');
    assert.doesNotMatch(file.content, /script/);
    assert.doesNotMatch(file.fileName, /[<>"]/);
  });
});

describe('file name', () => {
  it('drops what Windows forbids, control characters and surplus spaces', () => {
    assert.equal(sanitizeShortcutFileName('a\\b/c:d*e?f"g<h>i|j'), 'abcdefghij');
    assert.equal(sanitizeShortcutFileName('  여행   계획\t\n2026 '), '여행 계획2026');
    assert.equal(sanitizeShortcutFileName('line\u0000break\u001f'), 'linebreak');
  });

  it('falls back when nothing is left, for a Windows device name, or a name that is only dots', () => {
    for (const name of ['', '   ', '???', '***', '...', 'CON', 'nul', 'COM1', 'Lpt9', null, undefined]) {
      assert.equal(sanitizeShortcutFileName(name), SHORTCUT_FALLBACK_NAME, String(name));
    }
    assert.equal(sanitizeShortcutFileName('console'), 'console');
    assert.equal(buildShortcutFile('url', 'https://x.test', '???').fileName, 'Juple Collection.url');
  });

  it('cuts a trailing dot / space (Windows) and bounds the length without splitting a character', () => {
    assert.equal(sanitizeShortcutFileName('trip. . '), 'trip');
    const long = sanitizeShortcutFileName('가'.repeat(200));
    assert.equal(Array.from(long).length, 80);
    assert.equal(sanitizeShortcutFileName('😀'.repeat(100)), '😀'.repeat(80));
  });
});

describe('download', () => {
  it('builds a Blob, clicks a download link with the file name, and releases the object URL afterwards', () => {
    const events: string[] = [];
    let blob: Blob | null = null;
    const anchor = { href: '', download: '', click: () => events.push(`click:${anchor.download}:${anchor.href}`), remove: () => events.push('remove') };
    let later: (() => void) | null = null;
    downloadShortcutFile(buildShortcutFile('url', 'https://juple.co.kr/collections/5', '여행'), {
      createObjectUrl: created => {
        blob = created;
        events.push('create');
        return 'blob:fake-1';
      },
      revokeObjectUrl: url => events.push(`revoke:${url}`),
      createAnchor: () => anchor,
      append: () => events.push('append'),
      later: callback => {
        later = callback;
      },
    });
    assert.deepEqual(events, ['create', 'append', 'click:여행.url:blob:fake-1', 'remove']);
    assert.ok(blob);
    // Released only after the browser had the click (never before), exactly once.
    assert.ok(later);
    (later as () => void)();
    assert.deepEqual(events.slice(-1), ['revoke:blob:fake-1']);
  });

  it('even when the click throws the object URL is still released', () => {
    const revoked: string[] = [];
    let later: (() => void) | null = null;
    assert.throws(() =>
      downloadShortcutFile(buildShortcutFile('url', 'https://x.test', 'n'), {
        createObjectUrl: () => 'blob:fake-2',
        revokeObjectUrl: url => revoked.push(url),
        createAnchor: () => ({
          href: '',
          download: '',
          click: () => {
            throw new Error('blocked');
          },
        }),
        later: callback => {
          later = callback;
        },
      }),
    );
    (later as unknown as () => void)();
    assert.deepEqual(revoked, ['blob:fake-2']);
  });
});

describe('the Collection menu', () => {
  const view = source('app/(app)/collections/[collectionId]/CollectionDetailsView.tsx');

  it('adds 바로가기 만들기 for every Collection the person can open - personal, one they made and shared, or shared with them', () => {
    assert.match(view, /key: 'shortcut',\s*label: dictionary\.shortcutCreate,\s*icon: 'Link' as const/);
    // It sits in the shared part of the menu: not inside the owner-only or member-only branch.
    const item = view.indexOf("key: 'shortcut'");
    assert.ok(item > view.indexOf("key: 'notifications'"));
    assert.ok(item < view.indexOf("key: 'leave'"));
    assert.ok(item < view.indexOf("key: 'lock'"));
    assert.doesNotMatch(view.slice(view.indexOf('...(shortcutFormat === null'), item), /isSharedWithMe|isOwner|canManage/);
  });

  it('is offered only on a desktop browser (read on the client), and the file carries only the Collection route', () => {
    assert.match(view, /useSyncExternalStore<ShortcutFormat \| null>/);
    assert.match(view, /resolveShortcutFormat\(navigator\.userAgent, navigator\.maxTouchPoints\)/);
    assert.match(view, /shortcutFormat === null\s*\? \[\]/);
    assert.match(view, /collectionShortcutUrl\(window\.location\.origin, collection\.id\)/);
    const block = view.slice(view.indexOf("key: 'shortcut'"), view.indexOf('...(isSharedWithMe(collection)', view.indexOf("key: 'shortcut'")));
    assert.doesNotMatch(block, /token|share|publicId|unlock/i);
  });

  it('reports through the one toast (top layer: above any dialog), with the hint, and an error toast on failure', () => {
    assert.match(view, /toast\.showNotice\(`\$\{dictionary\.shortcutCreated\} \$\{dictionary\.shortcutHint\}`\)/);
    assert.match(view, /toast\.showNotice\(dictionary\.shortcutFailed, 'error'\)/);
    assert.match(source('app/(app)/Toaster.tsx'), /popover="manual"/);
  });

  it('no server involved: no fetch, no new endpoint, no dependency', () => {
    const lib = source('lib/desktopShortcut.ts');
    assert.doesNotMatch(lib, /fetch\(|XMLHttpRequest|import .* from '[^.']/);
    assert.doesNotMatch(readFileSync(new URL('../package.json', import.meta.url), 'utf8'), /shortcut/i);
  });

  it('the item is a labelled text menu entry (keyboard: the menu\'s own arrows / Enter), not an icon-only control', () => {
    const popover = source('app/(app)/Popover.tsx');
    assert.match(popover, /role="menuitem"/);
    assert.match(popover, /\{action\.label\}/);
  });
});

describe('strings', () => {
  it('Korean and English are written; the other languages use the Web\'s English fallback like every Web-only string', () => {
    const ko = getAppDictionary('ko');
    assert.equal(ko.shortcutCreate, '바로가기 만들기');
    assert.equal(ko.shortcutCreated, '바로가기를 만들었어요.');
    assert.equal(ko.shortcutHint, '다운로드한 파일을 바탕화면으로 옮기면 이 컬렉션을 바로 열 수 있어요.');
    const en = getAppDictionary('en');
    assert.equal(en.shortcutCreate, 'Create shortcut');
    for (const language of APP_LANGUAGES) {
      const words = getAppDictionary(language);
      for (const key of ['shortcutCreate', 'shortcutCreated', 'shortcutHint', 'shortcutFailed'] as const) {
        assert.ok(words[key].trim().length > 0, `${language}.${key}`);
      }
    }
  });
});
