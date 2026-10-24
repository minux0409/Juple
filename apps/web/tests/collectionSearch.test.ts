import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { APP_LANGUAGES } from '../lib/appI18n.ts';
import { getAppDictionary } from '../lib/appDictionary.ts';
import {
  COLLECTION_SEARCH_DEBOUNCE_MS,
  COLLECTION_SEARCH_MAX_LENGTH,
  collectionsPath,
  collectionsSearchUrl,
  collectionsTabUrl,
  normalizeCollectionSearch,
} from '../lib/collectionsView.ts';

const source = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const view = source('app/(app)/collections/CollectionsView.tsx');
const css = source('app/(app)/app.module.css');

describe('컬렉션 검색: the request', () => {
  it('no search = exactly the list as before; a term is the server\'s q, trimmed', () => {
    assert.equal(collectionsPath('all'), '/api/v1/collections?scope=all&limit=24');
    assert.equal(collectionsPath('all', null, ''), '/api/v1/collections?scope=all&limit=24');
    assert.equal(collectionsPath('all', null, '   '), '/api/v1/collections?scope=all&limit=24');
    assert.equal(collectionsPath('owned', null, '  Mili '), '/api/v1/collections?scope=owned&limit=24&q=Mili');
  });

  it('the term is encoded (never concatenated), keeps special characters whole, and is cut at the server\'s limit', () => {
    assert.equal(collectionsPath('all', null, "50% & 'x' <b>"), '/api/v1/collections?scope=all&limit=24&q=50%25+%26+%27x%27+%3Cb%3E');
    const long = 'a'.repeat(COLLECTION_SEARCH_MAX_LENGTH + 30);
    assert.equal(normalizeCollectionSearch(long).length, COLLECTION_SEARCH_MAX_LENGTH);
    assert.equal(normalizeCollectionSearch('가'.repeat(150)).length, COLLECTION_SEARCH_MAX_LENGTH);
    assert.equal(normalizeCollectionSearch(null), '');
  });

  it('the cursor and the term travel together (a page of this query), the tab is the scope', () => {
    assert.equal(collectionsPath('favorites', 'abc', 'mili'), '/api/v1/collections?scope=favorites&limit=24&cursor=abc&q=mili');
  });

  it('the matching is the server\'s: the Web never filters the loaded pages itself and never reads a Collection\'s links', () => {
    assert.doesNotMatch(view, /\.filter\(.*name|filterCollectionsByName|toLowerCase\(\)\.includes|items\/sections|\/items\?/);
    assert.match(view, /collectionsPath\(filter, null, search\)/);
  });
});

describe('컬렉션 검색: address state (Back from a Collection)', () => {
  const base = new URL('https://juple.co.kr/collections?tab=shared');

  it('the term lives in ?q= next to the tab; clearing removes it; the tab and other parameters stay', () => {
    assert.equal(collectionsSearchUrl(base, 'Mili').search, '?tab=shared&q=Mili');
    assert.equal(collectionsSearchUrl(new URL('https://juple.co.kr/collections?tab=shared&q=Mili'), '').search, '?tab=shared');
    assert.equal(collectionsSearchUrl(new URL('https://juple.co.kr/collections'), '  ').search, '');
  });

  it('changing the tab keeps the search; the search keeps the tab', () => {
    const searched = new URL('https://juple.co.kr/collections?q=Mili');
    assert.equal(collectionsTabUrl(searched, 'owned').searchParams.get('q'), 'Mili');
    assert.equal(collectionsTabUrl(searched, 'owned').searchParams.get('tab'), 'mine');
    assert.equal(collectionsSearchUrl(collectionsTabUrl(base, 'owned'), 'x').searchParams.get('tab'), 'mine');
  });

  it('the screen starts from the address\'s search and writes it back with replace (the history never fills)', () => {
    assert.match(view, /normalizeCollectionSearch\(searchParams\.get\(COLLECTION_SEARCH_PARAM\)\)/);
    assert.match(view, /router\.replace\(`\$\{target\.pathname\}\$\{target\.search\}`, \{ scroll: false \}\)/);
  });
});

describe('컬렉션 검색: the screen', () => {
  it('the search sits between the tabs (toolbar) and the cards, above the list', () => {
    const toolbar = view.indexOf('className={styles.toolbar}');
    const search = view.indexOf('data-collection-search>');
    const list = view.indexOf("state.kind === 'loaded' && (state.items.length > 0 || shownPending.length > 0)");
    assert.ok(toolbar > 0 && search > toolbar && list > search);
    // The field is the shared SearchField, wrapped by the suggestions box (it owns the combobox behaviour; the list is still read here).
    assert.match(view, /<CollectionSearchBox[\s\S]*?onTextChange=\{changeText\}/);
    assert.match(source('app/(app)/collections/CollectionSearchBox.tsx'), /<SearchField[\s\S]*placeholder=\{dictionary\.collectionListSearchPlaceholder\}[\s\S]*value=\{text\}/);
  });

  it('waits for the typing to pause (250ms), clears at once, and a newer term cancels the pending one', () => {
    assert.equal(COLLECTION_SEARCH_DEBOUNCE_MS, 250);
    assert.match(view, /setTimeout\(\(\) => \{\s*searchTimer\.current = null;\s*applySearch\(next\);\s*\}, COLLECTION_SEARCH_DEBOUNCE_MS\)/);
    assert.match(view, /clearTimeout\(searchTimer\.current\)/);
    assert.match(view, /if \(normalizeCollectionSearch\(next\) === ''\) \{\s*\/\/ Clearing is immediate\.\s*applySearch\(''\);/);
  });

  it('an old answer never lands on a newer list (effect cleanup; "load more" checks tab AND term)', () => {
    assert.match(view, /return \(\) => \{\s*ignore = true;\s*\};\s*\}, \[api, filter, onSessionLost, reloadToken, search\]\)/);
    assert.match(view, /requestedFilter === filter && requestedSearch === search/);
  });

  it('a changed search keeps the cards on screen (dimmed) instead of a full-page skeleton, and says "busy" to assistive technology', () => {
    assert.match(view, /aria-busy=\{state\.kind === 'loading' \|\| searching\}/);
    assert.match(view, /listSearching/);
    assert.match(view, /aria-live="polite"/);
    assert.match(css, /\.listSearching \{[^}]*opacity: 0\.6;/);
    // The skeleton stays for the first load and a tab change only.
    assert.doesNotMatch(view.slice(view.indexOf('const applySearch'), view.indexOf('const changeText')), /kind: 'loading'/);
  });

  it('no result for a search is its own message, not the "no collections yet" empty state', () => {
    assert.match(view, /search !== '' \? \(\s*<p className=\{styles\.emptyState\} data-collection-search-empty>\s*\{dictionary\.searchEmpty\}/);
    assert.match(view, /emptyLabel\(dictionary, filter\)/);
  });

  it('the field is the shared labelled search input with a clear button (theme tokens only, no raw colours)', () => {
    const field = source('app/(app)/SearchField.tsx');
    assert.match(field, /aria-label=\{placeholder\}/);
    assert.match(field, /aria-label=\{dictionary\.searchClear\}/);
    assert.match(field, /type="search"/);
    const rules = css.slice(css.indexOf('/* ---- Collections: the search'));
    assert.doesNotMatch(rules, /#[0-9a-fA-F]{3,8}\b|rgba?\(/);
  });
});

describe('컬렉션 검색: strings', () => {
  it('the placeholder exists in all 17 languages (translated); the empty and clear words are the Archive\'s', () => {
    const en = getAppDictionary('en');
    assert.equal(en.collectionListSearchPlaceholder, 'Search collections or links');
    assert.equal(getAppDictionary('ko').collectionListSearchPlaceholder, '컬렉션 또는 링크 검색');
    for (const language of APP_LANGUAGES) {
      const words = getAppDictionary(language);
      assert.ok(words.collectionListSearchPlaceholder.trim().length > 0, language);
      assert.ok(words.searchEmpty.trim().length > 0 && words.searchClear.trim().length > 0, language);
      if (language !== 'en') {
        assert.notEqual(words.collectionListSearchPlaceholder, en.collectionListSearchPlaceholder, language);
      }
    }
  });
});
