import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { exactCollectionCount, FAVORITE_SHORTCUT_COUNT, summaryCollectionsPath } from '../lib/homeSummary.ts';

const source = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

describe('Web-native layout: only real data fills the space', () => {
  it('a Collections number is shown only when exact (the whole list in one page - the API has no total count)', () => {
    assert.equal(exactCollectionCount({ items: [{}, {}, {}] as never, nextCursor: null }), 3);
    assert.equal(exactCollectionCount({ items: [{}, {}] as never, nextCursor: 'more' }), null, 'more pages = no number, never a guess');
    const path = new URL(summaryCollectionsPath('favorites'), 'http://x');
    assert.deepEqual(Object.fromEntries(path.searchParams), { scope: 'favorites', limit: '50' });
    assert.ok(FAVORITE_SHORTCUT_COUNT >= 4 && FAVORITE_SHORTCUT_COUNT <= 6);
  });

  it('Home: the add panel and today\'s links in the main column; exact counts, the two existing destinations and favorites beside them', () => {
    const home = source('app/(app)/HomeView.tsx');
    assert.match(home, /<AddLinkForm \/>\s*<div className={styles.dashboard}>\s*<div className={styles.dashboardMain}>/);
    assert.match(home, /<Glyph className=\{styles\.addLinkIcon\} name="Link"/);
    assert.match(home, /href="\/collections\/new"/);
    assert.match(home, /href="\/archive"/);
    assert.match(home, /if \(summary\?\.all != null\)/, 'a card is added only when its number is known');
    assert.match(home, /if \(cards\.length === 0\) \{\s*return null;/);
    assert.match(home, /summary && summary\.favoriteShortcuts\.length > 0/);
    assert.doesNotMatch(home, /recent|activity|recommend/i);
  });

  it('Collections: the title, then one toolbar with the filters, the view switch and 새 컬렉션; no total line (no such API)', () => {
    const view = source('app/(app)/collections/CollectionsView.tsx');
    const toolbar = view.indexOf('className={styles.toolbar}');
    assert.ok(view.indexOf('{dictionary.navCollections}</h1>') < toolbar);
    assert.ok(toolbar < view.indexOf('COLLECTION_FILTERS.map') && view.indexOf('COLLECTION_FILTERS.map') < view.indexOf('href="/collections/new"'));
    assert.match(view, /function ParticipantPreview[\s\S]*collection\.participantPreview/, 'people only from the row\'s own preview');
  });

  it('My Page 설정: the inner settings list opens the existing screens; the editor is a preview + form workspace', () => {
    const nav = source('lib/settingsNav.ts');
    for (const href of ['/me', '/me/language', '/me/collection-lock', '/me/subscription', '/me/account', '/me/account/delete']) {
      assert.ok(nav.includes(`href: '${href}'`), href);
    }
    const editor = source('app/(app)/collections/CollectionEditor.tsx');
    assert.ok(editor.indexOf('className={styles.editorAside}') < editor.indexOf('className={styles.editorMain}'));
  });

  it('content widths are tokens by purpose; the shell is wide; the review page uses it', () => {
    const css = source('app/(app)/app.module.css');
    assert.match(css, /--content-narrow: 900px;\s*--content-medium: 1280px;\s*--content-wide: 1640px;\s*--page-max: 1680px;/);
    assert.match(css, /\.reviewSections {[^}]*max-width: none;/);
    assert.match(css, /@media \(max-width: 1180px\) \{\s*\.dashboard \{\s*grid-template-columns: minmax\(0, 1fr\);/);
  });
});
