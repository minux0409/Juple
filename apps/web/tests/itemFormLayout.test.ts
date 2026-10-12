import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { pathToFileURL } from 'node:url';
// @ts-expect-error - a plain .mjs test helper
import { renderItemFormHtml } from './support/renderItemForm.mjs';

const css = readFileSync(new URL('../app/(app)/app.module.css', import.meta.url), 'utf8');
const form = readFileSync(new URL('../app/(app)/ItemForm.tsx', import.meta.url), 'utf8');

const BROWSERS = [
  process.env.CHROME_BIN ?? '',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].filter(candidate => candidate && existsSync(candidate));

interface Measured {
  readonly width: number;
  readonly cardPaddingTop: number;
  readonly titleToSearch: number;
  readonly searchToTiles: number;
  readonly sectionToMemoTitle: number;
  readonly memoTitleToArea: number;
  readonly cardPaddingBottom: number;
}

function measure(width: number): Measured {
  const dir = mkdtempSync(path.join(tmpdir(), 'juple-itemform-'));
  const file = path.join(dir, 'form.html');
  writeFileSync(file, renderItemFormHtml({ width }));
  const dom = execFileSync(BROWSERS[0], ['--headless=new', '--disable-gpu', '--no-first-run', `--user-data-dir=${path.join(dir, 'profile')}`, `--window-size=${width},1000`, '--dump-dom', pathToFileURL(file).href], {
    encoding: 'utf8',
    timeout: 60_000,
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  const title = /<title>([\s\S]*?)<\/title>/.exec(dom)?.[1];
  assert.ok(title, 'the page measured itself');
  return JSON.parse(title.replace(/&quot;/g, '"')) as Measured;
}

describe('ItemForm spacing - the CSS source', () => {
  it('the title owns the 24px under it (no fieldset / legend, no gap that a wrapper could swallow)', () => {
    assert.match(css, /--form-title-gap: 24px;/);
    assert.match(css, /\.itemFormSectionTitle \{\s*margin: 0 0 var\(--form-title-gap\);/);
    assert.match(css, /\.itemMemoSection \.itemFormSectionTitle \{\s*margin-bottom: var\(--form-field-title-gap\);/);
    assert.match(css, /--form-field-title-gap: 16px;/);
    assert.match(css, /--form-block-gap: 32px;/);
    assert.match(css, /\.reviewSections \{[^}]*gap: var\(--form-block-gap\);[^}]*padding: var\(--section-gap\);/);
    assert.match(css, /\.collectionPicker \{\s*display: flex;\s*flex-direction: column;\s*gap: var\(--space-3\);/);
    assert.doesNotMatch(form, /<fieldset|<legend/);
  });

  it('one stylesheet rule decides it: no other rule sets a margin or gap on these classes', () => {
    for (const name of ['itemFormSectionTitle', 'itemCollectionsSection', 'itemMemoSection']) {
      const rules = [...css.matchAll(new RegExp(`(^|\\n)[^\\n{}]*\\.${name}\\b[^{]*\\{[^}]*\\}`, 'g'))].map(match => match[0]);
      const spacing = rules.filter(rule => /\b(margin|gap|row-gap|padding)[a-z-]*:/.test(rule));
      assert.ok(spacing.length <= 2, `${name}: ${spacing.length} spacing rules`);
    }
    assert.doesNotMatch(css, /!important/);
  });
});

describe('ItemForm spacing - measured in a real browser (the real components, the real stylesheet)', { skip: BROWSERS.length === 0 ? 'no Chrome / Edge found' : false }, () => {
  for (const width of [1440, 1024, 700]) {
    it(`${width}px: title -> search 24px, search -> tiles 12px, Collections -> Memo >= 28px, memo title -> field >= 16px, card padding 24px`, () => {
      const m = measure(width);
      assert.equal(m.titleToSearch, 24, `title -> search ${JSON.stringify(m)}`);
      assert.equal(m.searchToTiles, 12, 'search -> tiles');
      assert.ok(m.sectionToMemoTitle >= 28, `Collections -> Memo ${m.sectionToMemoTitle}`);
      assert.ok(m.memoTitleToArea >= 16, `memo title -> field ${m.memoTitleToArea}`);
      assert.ok(m.cardPaddingTop >= 16 && m.cardPaddingBottom >= 16, `card padding ${m.cardPaddingTop} / ${m.cardPaddingBottom}`);
    });
  }
});
