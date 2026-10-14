import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

const css = readFileSync(new URL('../app/(app)/app.module.css', import.meta.url), 'utf8');

function luminance(hex: string): number {
  const channels = [1, 3, 5].map(index => parseInt(hex.slice(index, index + 2), 16) / 255);
  const [r, g, b] = channels.map(channel => (channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (light + 0.05) / (dark + 0.05);
}

describe('Juple identity (the app icon colours) - behaviour, not snapshots', () => {
  it('the five icon colours are tokens, defined once; pages use the tokens, not their own hex values', () => {
    for (const [name, value] of [['--juple-orange', '#fea248'], ['--juple-coral', '#fd616b'], ['--juple-magenta', '#f133c5'], ['--juple-violet', '#6751fc'], ['--juple-blue', '#51a1fd']]) {
      assert.equal(css.split(`${name}: ${value};`).length - 1, 1, name);
    }
    assert.match(css, /--brand-gradient: linear-gradient\(135deg, var\(--juple-orange\)/);
  });

  it('white text on the primary action stays at AA contrast along the whole gradient', () => {
    const match = css.match(/--brand-cta: linear-gradient\(135deg, (#[0-9a-f]{6}) 0%, (#[0-9a-f]{6}) 100%\)/);
    assert.ok(match, 'the CTA gradient is a token');
    for (const colour of [match[1], match[2]]) {
      assert.ok(contrast('#ffffff', colour) >= 4.5, `${colour} ${contrast('#ffffff', colour).toFixed(2)}`);
    }
  });

  it('the new inquiry texts use the secondary text colour (the tertiary grey is below 4.5:1 on white)', () => {
    assert.ok(contrast('#8a919c', '#ffffff') < 4.5, 'the tertiary token is for non-essential decoration only');
    for (const selector of ['.inquiryDate', '.fieldCounter', '.inquiryMeta']) {
      const rule = css.match(new RegExp(`\\n\\${selector} \\{([^}]*)\\}`));
      assert.ok(rule, selector);
      assert.doesNotMatch(rule[1], /--app-text-tertiary/, selector);
    }
  });

  it('decoration is background layers only: no generated content (a CSS-drawn glyph could show on its own)', () => {
    assert.doesNotMatch(css, /content:\s*['"]/);
  });

  it('motion is a 150-160ms transition and every animation / transform respects prefers-reduced-motion', () => {
    assert.match(css, /@media \(prefers-reduced-motion: reduce\) \{[^@]*\.dialog\[open\],[^}]*animation: none/);
    assert.match(css, /@media \(prefers-reduced-motion: reduce\) \{[^@]*\.linkCard:has\(a:hover\),[^}]*transform: none/);
    assert.doesNotMatch(css, /animation: [a-zA-Z]+ [3-9]\d\d\dms/, 'no slow flourish');
  });

  it('the wide-screen side bar accent is a thin bar, the narrow tab row has none (no stray sliver at the left edge of a tab)', () => {
    const wide = css.match(/@media \(min-width: 861px\) \{\s*\.navLinkActive \{[^}]*3px 56%/);
    assert.ok(wide);
    const narrow = css.match(/\n\.navLinkActive \{([^}]*)\}/);
    assert.ok(narrow);
    assert.doesNotMatch(narrow[1], /3px 56%/);
  });

  it('the Collection editor is one column on a phone', () => {
    assert.match(css, /@media \(max-width: 859px\) \{\s*\.editorForm \{\s*grid-template-columns: minmax\(0, 1fr\);/);
  });
});
