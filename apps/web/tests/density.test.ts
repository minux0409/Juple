import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { FAVORITE_SHORTCUT_COUNT, HOME_SUMMARY_PATH, parseHomeSummary } from '../lib/homeSummary.ts';

const source = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

describe('Web-native layout: only real data fills the space', () => {
  it('Home reads its Collections numbers and shortcuts with ONE exact summary, not three lists', () => {
    assert.equal(HOME_SUMMARY_PATH, '/api/v1/home/summary');
    assert.ok(FAVORITE_SHORTCUT_COUNT >= 4 && FAVORITE_SHORTCUT_COUNT <= 6);
    const parsed = parseHomeSummary({
      collectionCount: 12,
      favoriteCollectionCount: 7,
      sharedCollectionCount: 2,
      favoriteCollections: [
        { id: 5, name: 'Trip', itemCount: 3, icon: 'Folder', color: 'TRIP', iconImageUrl: 'https://img.example/a', iconImageVersion: 'v1' },
        { id: 4, name: '책', itemCount: 0, icon: 'Book', color: null, iconImageUrl: null, iconImageVersion: null },
      ],
    });
    assert.deepEqual(parsed && { all: parsed.all, favorites: parsed.favorites, shared: parsed.shared }, { all: 12, favorites: 7, shared: 2 });
    assert.deepEqual(
      parsed?.favoriteShortcuts.map(entry => [entry.id, entry.name, entry.itemCount, entry.isFavorite]),
      [
        [5, 'Trip', 3, true],
        [4, '책', 0, true],
      ],
    );
    assert.equal(parsed?.favoriteShortcuts[0].iconImageUrl, 'https://img.example/a');
    assert.equal(parsed?.favoriteShortcuts[1].iconImageUrl, null);
    // Zero is a real answer; anything malformed is no summary (Home shows no numbers - never a guess).
    assert.equal(parseHomeSummary({ collectionCount: 0, favoriteCollectionCount: 0, sharedCollectionCount: 0, favoriteCollections: [] })?.all, 0);
    const bad = [
      null,
      'x',
      {},
      { collectionCount: -1, favoriteCollectionCount: 0, sharedCollectionCount: 0, favoriteCollections: [] },
      { collectionCount: 1, favoriteCollectionCount: 0, sharedCollectionCount: 0 },
      { collectionCount: 1.5, favoriteCollectionCount: 0, sharedCollectionCount: 0, favoriteCollections: [] },
    ];
    for (const value of bad) {
      assert.equal(parseHomeSummary(value), null);
    }
    // A malformed shortcut is skipped, and never more than the page shows.
    const many = Array.from({ length: 9 }, (_, index) => ({ id: index + 1, name: `c${index}`, itemCount: 1, icon: 'Folder', color: null }));
    const capped = parseHomeSummary({ collectionCount: 9, favoriteCollectionCount: 9, sharedCollectionCount: 0, favoriteCollections: [{ id: 'bad' }, ...many] });
    assert.equal(capped?.favoriteShortcuts.length, FAVORITE_SHORTCUT_COUNT);
  });

  it('HomeView makes one summary request and no longer reads the three Collection scopes', () => {
    const home = source('app/(app)/HomeView.tsx');
    assert.match(home, /api<unknown>\(\{ path: HOME_SUMMARY_PATH \}\)/);
    assert.doesNotMatch(home, /scope: |summaryCollectionsPath|exactCollectionCount|\/api\/v1\/collections/);
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
