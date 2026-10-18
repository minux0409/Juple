import { collectionHref } from './savedLinks.ts';

/**
 * 컬렉션 바로가기 (desktop): a small file the person downloads and keeps on the desktop - a Windows Internet Shortcut (.url) or a macOS
 * web location (.webloc). The browser cannot write to the desktop itself, so it hands over a file made on the spot: nothing is stored
 * on a server, no endpoint is involved, and the file holds ONE thing - the address of the Collection's own page in the signed-in app
 * (/collections/{id}). Opening it goes through the normal sign-in and access rules, so a person who lost access just gets the usual
 * screen. No token, session or share link is ever put in it.
 */
export type ShortcutFormat = 'url' | 'webloc';

export interface ShortcutFile {
  readonly fileName: string;
  readonly mimeType: string;
  readonly content: string;
}

export const SHORTCUT_FALLBACK_NAME = 'Juple Collection';
const MAX_NAME_LENGTH = 80;
const WINDOWS_RESERVED_NAME = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

/**
 * Which file the browser's computer understands - a choice of FORMAT only, never of trust. A phone or tablet gets none (Juple's phone
 * Web hands people to the app instead): Android, iPhone / iPod, iPad, and a Mac that reports touch points (iPadOS asking for the
 * desktop site). A Mac gets .webloc; Windows, Linux and anything else get .url (the widely understood fallback).
 */
export function resolveShortcutFormat(userAgent: string | null | undefined, maxTouchPoints = 0): ShortcutFormat | null {
  const ua = userAgent ?? '';
  if (/android|iphone|ipod|ipad|mobile/i.test(ua)) {
    return null;
  }
  if (/macintosh|mac os x/i.test(ua)) {
    return maxTouchPoints > 1 ? null : 'webloc';
  }
  return 'url';
}

/**
 * A file name every desktop accepts: the characters Windows forbids (\ / : * ? " < > |) and control characters are dropped, spaces are
 * collapsed, a trailing dot / space is cut (Windows), a Windows device name (CON, NUL ...) or an empty result becomes the fallback, and
 * the length is bounded. The Collection's own name is never changed - only the file's.
 */
export function sanitizeShortcutFileName(name: string | null | undefined): string {
  const cleaned = Array.from(name ?? '')
    .filter(character => {
      const code = character.codePointAt(0) ?? 0;
      return code >= 32 && code !== 127 && !'\\/:*?"<>|'.includes(character);
    })
    .join('')
    .replace(/\s+/g, ' ')
    .trim();
  const bounded = Array.from(cleaned).slice(0, MAX_NAME_LENGTH).join('').replace(/[. ]+$/, '');
  return bounded === '' || WINDOWS_RESERVED_NAME.test(bounded) ? SHORTCUT_FALLBACK_NAME : bounded;
}

/** The Collection's page in the signed-in app, on the origin the person is using now. Nothing else: no query, no hash. */
export function collectionShortcutUrl(origin: string, collectionId: number): string {
  return `${origin.replace(/\/+$/, '')}${collectionHref(collectionId)}`;
}

export function escapeXml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

export function buildShortcutFile(format: ShortcutFormat, url: string, collectionName: string | null | undefined): ShortcutFile {
  // A line break in the address would let one value write another line of the file.
  const safeUrl = url.replace(/[\r\n]+/g, '');
  const base = sanitizeShortcutFileName(collectionName);
  if (format === 'webloc') {
    return {
      fileName: `${base}.webloc`,
      mimeType: 'application/octet-stream',
      content: [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
        '<plist version="1.0">',
        '<dict>',
        '\t<key>URL</key>',
        `\t<string>${escapeXml(safeUrl)}</string>`,
        '</dict>',
        '</plist>',
        '',
      ].join('\n'),
    };
  }
  return { fileName: `${base}.url`, mimeType: 'application/octet-stream', content: `[InternetShortcut]\r\nURL=${safeUrl}\r\n` };
}

export interface DownloadEnvironment {
  readonly createObjectUrl: (blob: Blob) => string;
  readonly revokeObjectUrl: (url: string) => void;
  readonly createAnchor: () => { href: string; download: string; click: () => void; remove?: () => void };
  readonly append?: (anchor: unknown) => void;
  /** Runs the callback later (the browser must have started the download before the address is released). */
  readonly later: (callback: () => void) => void;
}

function browserEnvironment(): DownloadEnvironment {
  return {
    createObjectUrl: blob => URL.createObjectURL(blob),
    revokeObjectUrl: url => URL.revokeObjectURL(url),
    createAnchor: () => document.createElement('a'),
    append: anchor => document.body.appendChild(anchor as Node),
    later: callback => void window.setTimeout(callback, 1000),
  };
}

/** Hands the file to the browser as a download (Blob + object URL + the download attribute) and releases the object URL afterwards. */
export function downloadShortcutFile(file: ShortcutFile, environment: DownloadEnvironment = browserEnvironment()): void {
  const url = environment.createObjectUrl(new Blob([file.content], { type: file.mimeType }));
  try {
    const anchor = environment.createAnchor();
    anchor.href = url;
    anchor.download = file.fileName;
    environment.append?.(anchor);
    anchor.click();
    anchor.remove?.();
  } finally {
    environment.later(() => environment.revokeObjectUrl(url));
  }
}
