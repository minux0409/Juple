import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import type { AppApi, AppApiRequest } from '../lib/appApi.ts';
import { FAVORITES_MAX_PAGES, loadAllFavorites, sortFavorites } from '../lib/homeFavorites.ts';
import { parseRecentLinks, recentLinksPath, recentLinkView, recordLinkOpened } from '../lib/recentLinks.ts';
import type { CollectionSummary } from '../lib/collectionsView.ts';

const source = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const collection = (id: number, name: string): CollectionSummary => ({ id, name, icon: 'Folder', color: null, itemCount: 0, isFavorite: true });

function pagedApi(pages: readonly (readonly CollectionSummary[])[]) {
  const requests: AppApiRequest[] = [];
  const api = (async (request: AppApiRequest) => {
    requests.push(request);
    const cursor = new URL(`http://x${request.path}`).searchParams.get('cursor');
    const index = cursor === null ? 0 : Number(cursor);
    return { items: pages[index], nextCursor: index + 1 < pages.length ? String(index + 1) : null };
  }) as AppApi;
  return { api, requests };
}

describe('Home 즐겨찾기: every favorite, not the first few', () => {
  it('reads the favorites scope page after page until the server has no more, each once', async () => {
    const { api, requests } = pagedApi([[collection(1, 'a'), collection(2, 'b')], [collection(2, 'b'), collection(3, 'c')], [collection(4, 'd')]]);

    const all = await loadAllFavorites(api);

    assert.deepEqual(all.map(item => item.id), [1, 2, 3, 4]);
    assert.equal(requests.length, 3);
    for (const request of requests) {
      assert.match(request.path, /^\/api\/v1\/collections\?scope=favorites&limit=\d+/);
    }
  });

  it('a failing page fails the whole read (never a half list presented as complete); a runaway cursor stops at the guard', async () => {
    const failing = (async () => {
      throw new Error('boom');
    }) as AppApi;
    await assert.rejects(loadAllFavorites(failing));
    let next = 0;
    const endless = (async () => ({ items: [collection((next += 1), 'x')], nextCursor: 'again' })) as AppApi;
    assert.equal((await loadAllFavorites(endless)).length, FAVORITES_MAX_PAGES);
  });

  it('시간순 is the server order or its reverse; 이름순 is by name in the person\'s language, numbers as numbers', () => {
    const items = [collection(1, 'Zoo'), collection(2, 'apple'), collection(3, 'Item 10'), collection(4, 'Item 2')];
    assert.deepEqual(sortFavorites(items, 'newest', 'en').map(i => i.id), [1, 2, 3, 4]);
    assert.deepEqual(sortFavorites(items, 'oldest', 'en').map(i => i.id), [4, 3, 2, 1]);
    assert.deepEqual(sortFavorites(items, 'title', 'en').map(i => i.id), [2, 4, 3, 1]);
    assert.deepEqual(sortFavorites(items, 'titleDesc', 'en').map(i => i.id), [1, 3, 4, 2]);
    assert.deepEqual(sortFavorites([collection(1, '나'), collection(2, '가')], 'title', 'ko').map(i => i.id), [2, 1]);
  });

  it('the component scrolls inside itself, keeps the view and sort per browser, and shows the empty sentence', () => {
    const favorites = source('app/(app)/HomeFavorites.tsx');
    assert.match(favorites, /COLLECTION_VIEW_MODE_STORAGE_KEY/);
    assert.match(favorites, /HOME_FAVORITES_SORT_STORAGE_KEY/);
    assert.match(favorites, /role="region" tabIndex=\{0\}/);
    assert.match(favorites, /dictionary\.emptyFavorites/);
    assert.match(favorites, /<CollectionCard collection=\{collection\} dictionary=\{dictionary\} layout=\{layout\} \/>/);
    const css = source('app/(app)/app.module.css');
    assert.match(css, /\.homeFavScroll \{[^}]*max-height: 468px;/);
    assert.match(css, /\.homeFavScroll,\s*\.homeFavScrollGrid \{[^}]*overflow-y: auto;/);
  });
});

describe('Home 최근 조회한 링크: only links the person opened', () => {
  it('reads the server list (newest first, ten) and draws the ordinary card for the link\'s own page', () => {
    assert.equal(recentLinksPath(), '/api/v1/recently-opened-links?limit=10');
    const entries = parseRecentLinks({
      items: [{ itemId: 7, url: 'https://shop.test/a', title: 'A', lastOpenedAtUtc: '2026-10-24T01:00:00Z', previewImageUrl: 'https://img.test/a.png' }, { bad: true }, 'x'],
      nextCursor: null,
    });
    assert.equal(entries?.length, 1, 'malformed rows are dropped');
    const view = recentLinkView(entries![0]);
    assert.equal(view.id, 7);
    assert.equal(view.href, '/items/7');
    assert.equal(view.externalUrl, 'https://shop.test/a');
    assert.equal(view.thumbnailUrl, 'https://img.test/a.png');
    assert.equal(view.locked, false);
    assert.equal(parseRecentLinks(null), null);
    assert.equal(parseRecentLinks({}), null);
  });

  it('an unsafe address is never offered as an external link or a picture', () => {
    const view = recentLinkView({ itemId: 1, url: 'javascript:alert(1)', title: null, lastOpenedAtUtc: '2026-10-24T01:00:00Z', previewImageUrl: 'javascript:x' });
    assert.equal(view.externalUrl, null);
    assert.equal(view.thumbnailUrl, null);
  });

  it('opening notes POST /items/{id}/open, silently, and never throws', async () => {
    const calls: AppApiRequest[] = [];
    const ok = (async (request: AppApiRequest) => void calls.push(request)) as AppApi;
    await recordLinkOpened(ok, 5);
    assert.deepEqual(calls.map(call => `${call.method} ${call.path}`), ['POST /api/v1/items/5/open']);
    const failing = (async () => {
      throw new Error('offline');
    }) as AppApi;
    await assert.doesNotReject(recordLinkOpened(failing, 5));
  });

  it('only the person\'s OWN link lists record it (Home, 보관함, their link\'s details) - never another member\'s link in a Collection', () => {
    for (const file of ['app/(app)/HomeView.tsx', 'app/(app)/archive/ArchiveView.tsx', 'app/(app)/items/[itemId]/ItemDetailContent.tsx']) {
      assert.match(source(file), /recordLinkOpened\(api,/, file);
    }
    for (const file of ['app/(app)/collections/[collectionId]/items/[itemId]/SharedItemView.tsx', 'app/(app)/collections/[collectionId]/items/[itemId]/SharedItemContent.tsx', 'app/(app)/collections/[collectionId]/CollectionDetailsView.tsx']) {
      assert.doesNotMatch(source(file), /recordLinkOpened/, file);
    }
  });

  it('clearing the history is confirmed first and removes only the history', () => {
    const recent = source('app/(app)/HomeRecentLinks.tsx');
    assert.match(recent, /method: 'DELETE', path: RECENT_LINKS_PATH/);
    assert.match(recent, /onConfirm=\{\(\) => void clear\(\)\}/);
    assert.match(recent, /dictionary\.homeRecentEmpty/);
  });
});
