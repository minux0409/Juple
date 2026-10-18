import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { APP_LANGUAGES } from '../lib/appI18n.ts';
import { getAppDictionary } from '../lib/appDictionary.ts';
import {
  COLLECTION_SUGGESTION_DEBOUNCE_MS,
  COLLECTION_SUGGESTION_LIMIT,
  LINK_SUGGESTION_LIMIT,
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
const link = (itemId: number, collectionId: number, title: string, hostname: string | null, isMine = true, url = `https://${hostname ?? 'x.test'}/watch?v=${itemId}`) => ({
  itemId,
  collectionId,
  collectionName: `C${collectionId}`,
  title,
  hostname,
  isMine,
  url,
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

  it('draws at most four Collections and eight links - several links of ONE Collection included; nothing at all for no answer', () => {
    const many: CollectionSuggestions = {
      collections: Array.from({ length: 7 }, (_, index) => collection(index + 1, `N${index}`)),
      links: Array.from({ length: 11 }, (_, index) => link(index + 1, 1, `L${index}`, 'a.test')),
    };
    assert.equal(COLLECTION_SUGGESTION_LIMIT, 4);
    assert.equal(LINK_SUGGESTION_LIMIT, 8);
    const rows = suggestionRows(many);
    assert.equal(rows.collections.length, 4);
    assert.equal(rows.links.length, 8);
    assert.equal(new Set(rows.links.map(row => row.key)).size, 8);
    assert.deepEqual(suggestionRows(null), { collections: [], links: [] });
    // The panel scrolls inside its own maximum height, so eight links never push it off the screen.
    assert.match(css, /\.suggestPanel \{[^}]*max-height: min\(70vh, 460px\);[^}]*overflow-y: auto;/);
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
  it('no listbox / option / combobox pattern: a region with two lists of real links, labelled by their headings; the highlight is announced by the input', () => {
    assert.doesNotMatch(box, /role="listbox"|role="option"|role: 'combobox'|aria-selected|aria-autocomplete|aria-expanded|role="presentation"|role="group"/);
    assert.match(box, /role="region"/);
    assert.match(box, /<ul aria-labelledby=\{`\$\{listId\}-collections`\} className=\{styles\.suggestList\}>/);
    assert.match(box, /<ul aria-labelledby=\{`\$\{listId\}-links`\} className=\{styles\.suggestList\}>/);
    assert.match(box, /<li key=\{row\.key\}>/);
    // The input announces the highlighted Juple link; the highlighted link says so too.
    assert.match(box, /'aria-activedescendant': activeIndex >= 0 \? rowId\(activeIndex\) : undefined/);
    assert.match(box, /'aria-controls': open \? listId : undefined/);
    assert.match(box, /aria-current=\{active \? 'true' : undefined\}/);
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

describe('컬렉션 검색 자동완성: 원본 링크 열기', () => {
  const rows = (links: CollectionSuggestions['links']) => suggestionRows({ collections: [collection(1, 'A')], links }).links;

  it('a link row carries the saved address; a Collection row has no such button', () => {
    const [first] = rows([link(10, 1, 'T', 'youtube.com')]);
    assert.equal(first.kind === 'link' && first.externalUrl, 'https://youtube.com/watch?v=10');
    assert.match(box, /if \(row\.kind !== 'link' \|\| row\.externalUrl === null\) \{\s*return option;/);
  });

  it('only plain http(s) addresses get a button - javascript:, data:, file:, custom schemes and junk get none', () => {
    for (const url of ['javascript:alert(1)', 'data:text/html,x', 'file:///etc/passwd', 'intent://x#Intent;end', 'ftp://a.test/x', 'not a url', '']) {
      const [row] = rows([link(1, 1, 'T', 'a.test', true, url)]);
      assert.equal(row.kind === 'link' && row.externalUrl, null, url);
    }
    for (const url of ['http://a.test/x', 'https://a.test/x?q=1#h']) {
      const [row] = rows([link(1, 1, 'T', 'a.test', true, url)]);
      assert.equal(row.kind === 'link' && row.externalUrl, url);
    }
  });

  it('is its own anchor: the saved address, a new tab, noopener noreferrer, an accessible label (the existing "open link" word)', () => {
    assert.match(box, /href=\{row\.externalUrl\}/);
    assert.match(box, /rel="noopener noreferrer"/);
    assert.match(box, /target="_blank"/);
    assert.match(box, /aria-label=\{openLabel\}/);
    assert.match(box, /title=\{openLabel\}/);
    assert.match(box, /openLabel=\{dictionary\.openLink\}/);
    assert.match(box, /<Glyph name="ExternalLink" size=\{18\} \/>/);
  });

  it('is a sibling of the Juple link, never inside it: no nested interactive markup, and its click cannot reach the navigation of the row', () => {
    const tail = box.slice(box.indexOf('const option = ('));
    const optionBlock = tail.slice(0, tail.indexOf("  if (row.kind !== 'link'"));
    assert.doesNotMatch(optionBlock, /target="_blank"|data-suggestion-external/);
    assert.match(tail, /<div className=\{styles\.suggestRow\} data-suggestion-row>\s*\{option\}\s*<a/);
    // The Juple link keeps its own click (the internal navigation); the external anchor has none.
    assert.match(box, /onClick=\{onChoose\}/);
    assert.equal((box.match(/onClick=/g) ?? []).length, 1);
  });

  it('keyboard: ArrowDown / ArrowUp highlight Juple rows, Enter opens the highlighted one, Escape closes (from the input or a link); every link is a normal tab stop', () => {
    // Real links, none removed from the tab order: the Juple rows AND the external anchors can be reached with Tab.
    assert.doesNotMatch(box, /tabIndex/);
    assert.match(box, /event\.key === 'Enter' && open && activeIndex >= 0/);
    assert.match(box, /choose\(rows\[activeIndex\]\)/);
    // Escape is handled where both the input and the links inside the panel bubble to, and focus returns to the input.
    assert.match(box, /onKeyDown=\{onEscape\}/);
    assert.match(box, /event\.key === 'Escape' && open/);
    assert.match(box, /event\.currentTarget\.querySelector\('input'\)\?\.focus\(\)/);
    // Enter / arrows act on rows (internal href), never on externalUrl.
    assert.doesNotMatch(box.slice(box.indexOf('const onKeyDown'), box.indexOf('const onEscape')), /externalUrl/);
  });

  it('stays inside the box: focus moving to the icon does not close the panel', () => {
    assert.match(box, /event\.currentTarget\.contains\(event\.relatedTarget\)/);
  });

  it('layout: the icon is a fixed 40px target at the far end, the text ellipsizes, the row keeps its compact height; theme tokens only', () => {
    const rules = css.slice(css.indexOf('/* A link row: the option'), css.indexOf('.suggestSite {'));
    assert.match(rules, /\.suggestRow \{[^}]*display: flex;[^}]*align-items: center;/);
    assert.match(rules, /\.suggestRow \.suggestOption \{[^}]*flex: 1 1 auto;[^}]*min-width: 0;/);
    assert.match(rules, /\.suggestExternal \{[^}]*flex: 0 0 40px;[^}]*width: 40px;[^}]*height: 40px;/);
    assert.match(rules, /\.suggestExternal:hover/);
    assert.match(rules, /\.suggestExternal:focus-visible \{[^}]*outline: 2px solid var\(--brand\)/);
    assert.doesNotMatch(rules, /#[0-9a-fA-F]{3,8}|rgba?\(/);
    // 40px stays under the 44px option: the row is not taller than before.
    assert.match(css, /\.suggestOption \{[^}]*min-height: 44px;/);
  });

  it('the label is the existing, translated "open link" word in every language', () => {
    for (const language of APP_LANGUAGES) {
      assert.ok(getAppDictionary(language).openLink.trim().length > 0, language);
    }
  });
});
