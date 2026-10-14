import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

const source = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

describe('dialog scrolling', () => {
  const css = source('app/(app)/app.module.css');
  const rule = (selector: string): string => {
    const match = css.match(new RegExp(`(?:^|\\n)${selector.replace(/[.[\]]/g, '\\$&')} \\{([^}]*)\\}`));
    assert.ok(match, `${selector} rule exists`);
    return match[1];
  };

  it('the rounded shell never scrolls: overflow hidden on every centred dialog, only an inner part scrolls', () => {
    assert.match(rule('.dialog'), /overflow: hidden/);
    assert.match(rule('.dialog'), /max-height: min\(85dvh, 640px\)/);
    assert.match(rule('.dialogBody'), /overflow-y: auto/);
    assert.match(rule('.dialogBody'), /min-height: 0/);
    assert.match(css, /\.friendPickerDialog,\s*\.reactionPicker \{\s*overflow: hidden;/);
    assert.match(css, /\.panelDialog\[open\] \{[^}]*overflow: hidden/);
    assert.match(rule('.panelScroll'), /overflow-y: auto/);
  });

  it('title and actions stay put: the shell is a column and the head / foot do not shrink', () => {
    assert.match(rule('.dialog[open]'), /flex-direction: column/);
    assert.match(rule('.dialogHead'), /flex: 0 0 auto/);
    assert.match(css, /\.dialog > \.dialogFoot \{[^}]*flex: 0 0 auto/);
  });

  it('a long name or URL wraps inside instead of widening the dialog (shell width is capped to the viewport)', () => {
    assert.match(rule('.dialog'), /width: min\(480px, calc\(100vw - 32px\)\)/);
    assert.match(rule('.dialogBody'), /overflow-wrap: anywhere/);
    assert.match(rule('.dialogBody'), /min-width: 0/);
    assert.match(rule('.panelScroll'), /overflow-wrap: anywhere/);
  });

  it('every message / confirm / password dialog uses the one structure', () => {
    const confirm = source('app/(app)/ConfirmDialog.tsx');
    assert.match(confirm, /styles\.dialogHead/);
    assert.match(confirm, /styles\.dialogBody/);
    assert.match(confirm, /styles\.dialogFoot/);
    const password = source('app/(app)/PasswordDialog.tsx');
    assert.match(password, /styles\.dialogBody/);
    assert.match(password, /styles\.dialogFoot/);
  });

});
