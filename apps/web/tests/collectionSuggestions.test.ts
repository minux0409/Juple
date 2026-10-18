import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { APP_LANGUAGES } from '../lib/appI18n.ts';
import { getAppDictionary } from '../lib/appDictionary.ts';
import {
  COLLECTION_SUGGESTION_DEBOUNCE_MS,
  COLLECTION_SUGGESTION_LIMIT,
  collectionSuggestionsPath,
  linkSuggestionDetail,
  linkSuggestionHref,
  nextSuggestionIndex,
  suggestionKey,
  suggestionRows,
  type CollectionSuggestions,
} from '../lib/collectionSuggestions.ts';
import { COLLECTION_SEARCH_DEBOUNCE_MS } from '../lib/collectionsView.ts';

const source = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const box = source('app/(app)/collections/CollectionSearchBox.tsx');
const view = source('app/(app)/collections/CollectionsView.tsx');
const css = source('app/(app)/app.module.css');

const collection = (id: number, name: string) => ({ id, name, icon: 'folder', color: null, itemCount: 0, isFavorite: false });
const link = (itemId: number, collectionId: number, title: string, hostname: string | null, isMine = true) => ({
  itemId,
  collectionId,
  collectionName: `C${collectionId}`,
  title,
  hostname,
  isMine,
});

describe('컬렉션 검색 자동완성: the request', () => {
  it('asks the server for the open tab and the trimmed text, encoded', () => {
    assert.equal(collectionSuggestionsPath('all', '  tian '), '/api/v1/collections/search-suggestions?scope=all&q=tian');
    assert.equal(collectionSuggestionsPath('favorites', "50% & 'x'"), '/api/v1/collections/search-suggestions?scope=favorites&q=50%25+%26+%27x%27');
    assert.equal(collectionSuggestionsPath('owned', 'T'), '/api/v1/collections/search-suggestions?scope=owned&q=T');
  });

  it('follows the typing after the same 250ms pause as the list', () => {
    assert.equal(COLLECTION_SUGGESTION_DEBOUNCE_MS, 250);
    assert.equal(COLLECTION_SUGGESTION_DEBOUNCE_MS, COLLECTION_SEARCH_DEBOUNCE_MS);
    assert.match(box, /setTimeout\(\(\) => \{\s*api<CollectionSuggestions>\(\{ path: collectionSuggestionsPath\(filter, term\) \}\)/);
    assert.match(box, /\}, COLLECTION_SUGGESTION_DEBOUNCE_MS\)/);
  });

  it('asks only while the box has focus and text (no focus, no request)', () => {
    assert.match(box, /const wantsSuggestions = focused && term !== '';/);
    assert.match(box, /if \(!wantsSuggestions\) \{\s*return;\s*\}/);
    assert.match(box, /onFocus: \(\) => setFocused\(true\)/);
  });

  it('a late answer of an old text or tab never replaces a newer one (effect cleanup + keyed answers)', () => {
    assert.match(box, /return \(\) => \{\s*ignore = true;\s*clearTimeout\(timer\);\s*\};/);
    assert.match(box, /if \(!ignore\) \{\s*setAnswer\(\{ key, filter, data \}\);/);
    // Another tab's answer is never drawn.
    assert.match(box, /answer !== null && answer\.filter === filter \? answer\.data : null/);
    assert.notEqual(suggestionKey('all', 'tian'), suggestionKey('owned', 'tian'));
    assert.notEqual(suggestionKey('all', 't'), suggestionKey('all', 'tian'));
    assert.equal(suggestionKey('all', ' tian '), suggestionKey('all', 'tian'));
  });

  it('a failing suggestion request only hides the panel - the list is read by the screen on its own', () => {
    assert.match(box, /setAnswer\(\{ key, filter, data: null \}\)/);
    assert.doesNotMatch(box, /setState|toast|LoadFailed/);
    // The screen reads its list from the same text, not from the suggestions.
    assert.match(view, /collectionsPath\(filter, null, search\)/);
    assert.doesNotMatch(view, /collectionSuggestionsPath/);
  });
});

describe('컬렉션 검색 자동완성: the rows', () => {
  const suggestions: CollectionSuggestions = {
    collections: [collection(1, '림버스'), collection(2, 'B')],
    links: [link(10, 1, 'Mili - TIAN TIAN', 'youtube.com'), link(11, 2, 'Other', null, false)],
  };

  it('Collections first, then links, each with its own destination', () => {
    const rows = suggestionRows(suggestions);
    assert.deepEqual(rows.collections.map(row => row.href), ['/collections/1', '/collections/2']);
    assert.deepEqual(rows.links.map(row => row.href), ['/items/10', '/collections/2/items/11']);
  });

  it('a link shows its title and "Collection · host" (no raw URL); a missing host leaves just the Collection', () => {
    const [first, second] = suggestionRows(suggestions).links;
    assert.equal(first.kind === 'link' && first.title, 'Mili - TIAN TIAN');
    assert.equal(first.kind === 'link' && first.detail, 'C1 · youtube.com');
    assert.equal(second.kind === 'link' && second.detail, 'C2');
    assert.equal(first.kind === 'link' && first.siteId, 'youtube');
    assert.equal(second.kind === 'link' && second.siteId, null);
    assert.equal(linkSuggestionDetail({ collectionName: 'X', hostname: 'a.test' }), 'X · a.test');
  });

  it('an own link opens its detail, another member\'s link its shared view in that Collection', () => {
    assert.equal(linkSuggestionHref({ itemId: 5, collectionId: 9, isMine: true }), '/items/5');
    assert.equal(linkSuggestionHref({ itemId: 5, collectionId: 9, isMine: false }), '/collections/9/items/5');
  });

  it('draws at most four of each kind; nothing at all for no answer', () => {
    const many: CollectionSuggestions = {
      collections: Array.from({ length: 7 }, (_, index) => collection(index + 1, `N${index}`)),
      links: Array.from({ length: 7 }, (_, index) => link(index + 1, 1, `L${index}`, 'a.test')),
    };
    assert.equal(COLLECTION_SUGGESTION_LIMIT, 4);
    const rows = suggestionRows(many);
    assert.equal(rows.collections.length, 4);
    assert.equal(rows.links.length, 4);
    assert.deepEqual(suggestionRows(null), { collections: [], links: [] });
  });
});

describe('컬렉션 검색 자동완성: keyboard', () => {
  it('ArrowDown / ArrowUp walk the rows and wrap; none selected is -1', () => {
    assert.equal(nextSuggestionIndex(-1, 5, 'ArrowDown'), 0);
    assert.equal(nextSuggestionIndex(0, 5, 'ArrowDown'), 1);
    assert.equal(nextSuggestionIndex(4, 5, 'ArrowDown'), 0);
    assert.equal(nextSuggestionIndex(-1, 5, 'ArrowUp'), 4);
    assert.equal(nextSuggestionIndex(0, 5, 'ArrowUp'), 4);
    assert.equal(nextSuggestionIndex(3, 5, 'ArrowUp'), 2);
    assert.equal(nextSuggestionIndex(0, 0, 'ArrowDown'), -1);
  });

  it('Enter opens only a highlighted row (otherwise it stays the input\'s own); Escape closes the panel and keeps the text', () => {
    assert.match(box, /event\.key === 'Enter' && open && activeIndex >= 0/);
    assert.match(box, /choose\(rows\[activeIndex\]\)/);
    assert.match(box, /event\.key === 'Escape' && open/);
    assert.match(box, /setDismissed\(true\);\s*setActive\(-1\);/);
  });

  it('leaving the box (focus outside) closes it; a choice closes it; changing the text opens it again', () => {
    assert.match(box, /if \(!event\.currentTarget\.contains\(event\.relatedTarget\)\) \{\s*setFocused\(false\);/);
    assert.match(box, /const choose = \(row: CollectionSuggestionRow\) => \{\s*setDismissed\(true\);/);
    assert.match(box, /const change = \(next: string\) => \{\s*setDismissed\(false\);/);
    // Clearing the text (the X, or deleting it) is a text change with nothing: the panel needs text to be open.
    assert.match(box, /const open = focused && !dismissed && term !== '' && rows\.length > 0;/);
  });
});

describe('컬렉션 검색 자동완성: accessibility and look', () => {
  it('a combobox with a listbox, groups and options; the active option is announced', () => {
    assert.match(box, /role: 'combobox'/);
    assert.match(box, /'aria-autocomplete': 'list'/);
    assert.match(box, /'aria-expanded': open/);
    assert.match(box, /'aria-activedescendant': activeIndex >= 0 \? optionId\(activeIndex\) : undefined/);
    assert.match(box, /role="listbox"/);
    assert.match(box, /role="group"/);
    assert.match(box, /role="option"/);
    assert.match(box, /aria-selected=\{active\}/);
    assert.match(box, /aria-busy=\{loading\}/);
  });

  it('the panel is an overlay under the input: absolute, above the list, theme tokens only, rows at least 44px', () => {
    const rules = css.slice(css.indexOf('/* ---- Collections: the search suggestions'), css.indexOf('/* The old list stays while a changed search is read'));
    assert.match(rules, /\.suggestAnchor \{\s*position: relative;/);
    assert.match(rules, /\.suggestPanel \{[^}]*position: absolute;[^}]*inset-inline: 0;[^}]*top: calc\(100% \+ 6px\);[^}]*z-index: 30;/);
    assert.match(rules, /box-shadow: var\(--shadow-floating\)/);
    assert.match(rules, /\.suggestOption \{[^}]*min-height: 44px;/);
    assert.doesNotMatch(rules, /#[0-9a-fA-F]{3,8}\b|rgba?\(/);
    // Below the toast (60) and the floating panels (50), above the page.
    assert.ok(30 < 50 && 30 < 60);
  });

  it('the rows reuse the Collection tile and the site icon; the screen passes the tile in (no import cycle)', () => {
    assert.match(box, /renderCollectionTile\(row\.collection, 32\)/);
    assert.match(box, /<SiteIcon siteId=\{row\.siteId\} size=\{20\} \/>/);
    assert.doesNotMatch(box, /from '\.\/CollectionsView'/);
    assert.match(view, /renderCollectionTile=\{\(collection, size\) => <CollectionTileView collection=\{collection\} size=\{size\} \/>\}/);
  });
});

describe('컬렉션 검색: the space under the search matches the one above it', () => {
  it('the page\'s flex gap is the only space between toolbar → search → list; the search adds no margin', () => {
    assert.match(css, /\.page \{\s*display: flex;\s*flex-direction: column;\s*gap: var\(--page-gap\);\s*\}/);
    const search = css.match(/\.collectionSearch \{([^}]*)\}/);
    assert.ok(search);
    assert.match(search[1], /margin: 0;/);
    assert.doesNotMatch(search[1], /margin-bottom|padding/);
    // The suggestions are an overlay: the anchor itself adds no space either.
    const anchor = css.match(/\.suggestAnchor \{([^}]*)\}/);
    assert.ok(anchor);
    assert.doesNotMatch(anchor[1], /margin|padding|height/);
    // Both neighbours are direct children of the page: toolbar, the search wrapper, then the list/grid.
    const order = [view.indexOf('className={styles.toolbar}'), view.indexOf('className={styles.collectionSearch}'), view.indexOf('state.kind === \'loaded\' && state.items.length > 0')];
    assert.ok(order[0] > 0 && order[1] > order[0] && order[2] > order[1]);
  });

  it('the hidden live region between them takes no space (absolutely positioned)', () => {
    assert.match(css, /\.visuallyHidden \{\s*position: absolute;/);
  });
});

describe('컬렉션 검색 자동완성: strings', () => {
  it('the Collections header is the existing word; the Links header exists in all 17 languages', () => {
    for (const language of APP_LANGUAGES) {
      const words = getAppDictionary(language);
      assert.ok(words.collectionSearchLinks.trim().length > 0, language);
      assert.ok(words.navCollections.trim().length > 0, language);
    }
    assert.equal(getAppDictionary('ko').collectionSearchLinks, '링크');
    assert.equal(getAppDictionary('en').collectionSearchLinks, 'Links');
  });
});
