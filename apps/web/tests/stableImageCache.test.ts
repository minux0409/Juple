import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { afterEach, describe, it } from 'node:test';
import { representativePhotoKey } from '../lib/itemDetails.ts';
import { historyLinkView, thumbnailKeyOf } from '../lib/savedLinks.ts';
import { clearStableImageUris, imageCacheKey, replaceFailedStableImageUri, resolveStableImageUri, stableImageUriCount } from '../lib/stableImageUri.ts';

const source = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const signed = (n: number) => `https://blob.test/items/1/2/photo.thumb.webp?sig=${n}`;
const withWindow = (run: () => void) => {
  const global = globalThis as { window?: unknown };
  global.window = {};
  try {
    run();
  } finally {
    delete global.window;
  }
};

afterEach(() => clearStableImageUris());

describe('stable item-photo URLs (the SAS changes per response, the Blob does not)', () => {
  it('in the browser, the first signed URL of a photo variant is reused for later responses', () => withWindow(() => {
    const key = imageCacheKey(25, 'thumb');
    assert.equal(resolveStableImageUri(key, signed(1)), signed(1));
    assert.equal(resolveStableImageUri(key, signed(2)), signed(1));
    assert.notEqual(imageCacheKey(25, 'thumb'), imageCacheKey(25, 'main'));
  }));

  it('never on the server: module state there would be shared between requests and people', () => {
    const key = imageCacheKey(25, 'thumb');
    assert.equal(resolveStableImageUri(key, signed(1)), signed(1));
    assert.equal(resolveStableImageUri(key, signed(2)), signed(2));
    assert.equal(stableImageUriCount(), 0);
  });

  it('a kept URL that failed is replaced by the fresh one; no key / no id / no URL passes straight through', () => withWindow(() => {
    const key = imageCacheKey(7, 'main')!;
    resolveStableImageUri(key, signed(1));
    replaceFailedStableImageUri(key, signed(1), signed(2));
    assert.equal(resolveStableImageUri(key, signed(3)), signed(2));
    assert.equal(imageCacheKey(undefined, 'main'), null);
    assert.equal(resolveStableImageUri(null, 'https://cdn.test/og.jpg'), 'https://cdn.test/og.jpg');
    assert.equal(resolveStableImageUri(key, null), null);
  }));

  it('is bounded (oldest first) and cleared at the session boundary', () => withWindow(() => {
    for (let id = 1; id <= 501; id++) {
      resolveStableImageUri(imageCacheKey(id, 'thumb'), `https://x.test/${id}?sig=a`);
    }
    assert.equal(stableImageUriCount(), 500);
    assert.equal(resolveStableImageUri(imageCacheKey(1, 'thumb'), 'https://x.test/1?sig=b'), 'https://x.test/1?sig=b');
    clearStableImageUris();
    assert.equal(stableImageUriCount(), 0);
  }));

  it('lists key the photo they show (thumbnail, else the older full photo); Item Details keys the main photo', () => {
    assert.equal(thumbnailKeyOf({ coverImage: { id: 9, readUrl: 'm', thumbnailReadUrl: 't' }, representativeImage: null }), '9:thumb');
    assert.equal(thumbnailKeyOf({ coverImage: null, representativeImage: { id: 4, readUrl: 'm' } }), '4:main');
    assert.equal(thumbnailKeyOf({ coverImage: null, representativeImage: null }), null);
    assert.equal(historyLinkView({ id: 1, url: 'https://e.test', title: 't', savedAtUtc: '2026-10-16T00:00:00Z', coverImage: { id: 9, readUrl: 'm', thumbnailReadUrl: 't' } } as never).thumbnailCacheKey, '9:thumb');
    assert.equal(representativePhotoKey([{ id: 12, readUrl: 'm' } as never], 12), '12:main');
    assert.equal(representativePhotoKey([{ id: 0, readUrl: 'm' } as never], null), null);
  });

  it('every picture goes through it: lists and Item Details pass the key, LinkImage falls back once, sign-out clears it', () => {
    const image = source('app/(app)/LinkImage.tsx');
    assert.match(image, /const kept = resolveStableImageUri\(cacheKey, src\);/);
    assert.match(image, /const shown = \[kept, src\]\.find\(candidate => !!candidate && !failedSrcs\.has\(candidate\)\) \?\? null;/);
    assert.match(image, /replaceFailedStableImageUri\(cacheKey, shown, src\)/);
    assert.match(source('app/(app)/SavedLinkList.tsx'), /cacheKey=\{link\.thumbnailCacheKey\}/);
    assert.match(source('app/(app)/items/[itemId]/ItemDetailContent.tsx'), /cacheKey=\{photoKey\}/);
    const root = source('app/(app)/AppRoot.tsx');
    assert.match(root, /forgetAllUnlocks\(\);\s*clearStableImageUris\(\);/, 'every local session end');
    assert.match(root, /setStatus\('redirecting'\);\s*clearStableImageUris\(\);\s*\/\/ Clears MSAL's cache/, 'sign-out');
  });
});
