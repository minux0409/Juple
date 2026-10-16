import ReactTestRenderer, { act } from 'react-test-renderer';
import { Image, Text } from 'react-native';
import {
  clearStableImageUris,
  imageCacheKey,
  replaceFailedStableImageUri,
  resolveStableImageUri,
  stableImageUriCountForTests,
} from '../stableImageUri';
import { StableImage } from '../StableImage';

const signed = (n: number) => `https://blob.example/items/1/2/photo.thumb.webp?sig=${n}`;

beforeEach(() => clearStableImageUris());

describe('stable image URIs (the SAS changes per response, the photo does not)', () => {
  it('keeps the first signed URL of a photo variant for every later response', () => {
    const key = imageCacheKey(25, 'thumb');
    expect(resolveStableImageUri(key, signed(1))).toBe(signed(1));
    expect(resolveStableImageUri(key, signed(2))).toBe(signed(1));
    expect(resolveStableImageUri(key, signed(3))).toBe(signed(1));
  });

  it('keeps the thumbnail and the main photo apart', () => {
    expect(imageCacheKey(25, 'thumb')).not.toBe(imageCacheKey(25, 'main'));
    resolveStableImageUri(imageCacheKey(25, 'thumb'), 'https://t?sig=1');
    expect(resolveStableImageUri(imageCacheKey(25, 'main'), 'https://m?sig=2')).toBe('https://m?sig=2');
  });

  it('passes external previews (no key) and "no photo" straight through', () => {
    expect(resolveStableImageUri(null, 'https://cdn.example/og.jpg')).toBe('https://cdn.example/og.jpg');
    expect(resolveStableImageUri(imageCacheKey(1, 'main'), null)).toBeNull();
    expect(stableImageUriCountForTests()).toBe(0);
  });

  it('replaces a kept URL that failed with the fresh one - only if it is still the kept one', () => {
    const key = imageCacheKey(7, 'main');
    resolveStableImageUri(key, signed(1));
    replaceFailedStableImageUri(key, signed(99), signed(2)); // not the kept one: ignored
    expect(resolveStableImageUri(key, signed(3))).toBe(signed(1));
    replaceFailedStableImageUri(key, signed(1), signed(2));
    expect(resolveStableImageUri(key, signed(3))).toBe(signed(2));
  });

  it('is bounded: the oldest photo is forgotten first', () => {
    for (let id = 1; id <= 501; id++) {
      resolveStableImageUri(imageCacheKey(id, 'thumb'), `https://x/${id}?sig=a`);
    }
    expect(stableImageUriCountForTests()).toBe(500);
    expect(resolveStableImageUri(imageCacheKey(1, 'thumb'), 'https://x/1?sig=b')).toBe('https://x/1?sig=b');
    expect(resolveStableImageUri(imageCacheKey(501, 'thumb'), 'https://x/501?sig=b')).toBe('https://x/501?sig=a');
  });

  it('forgets everything when the session ends (a different account never reuses a URL)', () => {
    resolveStableImageUri(imageCacheKey(5, 'thumb'), signed(1));
    clearStableImageUris();
    expect(resolveStableImageUri(imageCacheKey(5, 'thumb'), signed(2))).toBe(signed(2));
  });
});

describe('StableImage', () => {
  function render(uri: string | null) {
    let renderer!: ReactTestRenderer.ReactTestRenderer;
    act(() => {
      renderer = ReactTestRenderer.create(<StableImage cacheKey={imageCacheKey(25, 'thumb')} fallback={<Text>fallback</Text>} uri={uri} />);
    });
    return renderer;
  }

  it('renders the kept URL on a later response (the image cache hits instead of a new download)', () => {
    render(signed(1));
    const later = render(signed(2));
    expect(later.root.findByType(Image).props.source).toEqual({ uri: signed(1) });
  });

  it('expired kept URL -> the fresh URL once; fresh URL also fails -> the fallback, no retry loop', () => {
    render(signed(1));
    const renderer = render(signed(2));
    act(() => renderer.root.findByType(Image).props.onError());
    expect(renderer.root.findByType(Image).props.source).toEqual({ uri: signed(2) });
    act(() => renderer.root.findByType(Image).props.onError());
    expect(renderer.root.findAllByType(Image)).toHaveLength(0);
    expect(renderer.root.findByType(Text).props.children).toBe('fallback');
    // The fresh URL is now the kept one for this photo.
    expect(resolveStableImageUri(imageCacheKey(25, 'thumb'), signed(3))).toBe(signed(2));
  });
});

describe('session boundary', () => {
  it('every way out of a session (setSignedOut) clears the kept Item, Collection icon and profile photo URLs', () => {
    const source: string = require('fs').readFileSync(require('path').resolve(__dirname, '../../auth/AuthContext.tsx'), 'utf8');
    const body = source.slice(source.indexOf('const setSignedOut = useCallback('), source.indexOf('setState(SIGNED_OUT_STATE);'));
    for (const clear of ['clearStableImageUris();', 'clearCollectionIconCache();', 'clearProfileImageCache();']) {
      expect(body).toContain(clear);
    }
  });
});
