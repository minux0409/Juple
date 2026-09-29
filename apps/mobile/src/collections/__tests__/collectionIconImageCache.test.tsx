import ReactTestRenderer, { act } from 'react-test-renderer';
import { Image } from 'react-native';
import { CategoryIconTile } from '../CategoryIconTile';
import {
  forgetCollectionIcon,
  rememberLocalCollectionIcon,
  resetCollectionIconCacheForTests,
  resolveCollectionIconUri,
} from '../collectionIconImageCache';
import { FolderIcon } from '../../icons/FolderIcon';

// Every response signs the same photo with a different, short-lived URL.
const signed = (n: number) => `https://blob.example.test/items/7/collections/42/photo.jpg?sig=${n}`;

beforeEach(() => {
  resetCollectionIconCacheForTests();
});

describe('collectionIconImageCache', () => {
  it('first load: the fresh signed URL is used', () => {
    expect(resolveCollectionIconUri(42, 'v1', signed(1))).toBe(signed(1));
  });

  it('a later response for the same photo keeps the first URI (image-cache hit) - never a new download', () => {
    resolveCollectionIconUri(42, 'v1', signed(1));

    expect(resolveCollectionIconUri(42, 'v1', signed(2))).toBe(signed(1));
    expect(resolveCollectionIconUri(42, 'v1', signed(3))).toBe(signed(1));
  });

  it('a replaced photo (new version) is never shown from the old entry', () => {
    resolveCollectionIconUri(42, 'v1', signed(1));

    expect(resolveCollectionIconUri(42, 'v2', signed(2))).toBe(signed(2));
    expect(resolveCollectionIconUri(42, 'v2', signed(3))).toBe(signed(2));
  });

  it('a removed photo drops the entry - nothing stale comes back', () => {
    resolveCollectionIconUri(42, 'v1', signed(1));

    expect(resolveCollectionIconUri(42, null, null)).toBeNull();
    expect(resolveCollectionIconUri(42, 'v1', signed(2))).toBe(signed(2));

    resolveCollectionIconUri(42, 'v1', signed(3));
    forgetCollectionIcon(42);
    expect(resolveCollectionIconUri(42, 'v1', signed(4))).toBe(signed(4));
  });

  it('the file the user just picked stands for the new version right away', () => {
    resolveCollectionIconUri(42, 'v1', signed(1));

    rememberLocalCollectionIcon(42, 'v2', 'file:///cache/picked.jpg');

    expect(resolveCollectionIconUri(42, 'v2', signed(2))).toBe('file:///cache/picked.jpg');
  });

  it('an older server without versions keeps the previous behavior - the fresh URL as-is', () => {
    expect(resolveCollectionIconUri(42, undefined, signed(1))).toBe(signed(1));
    expect(resolveCollectionIconUri(42, undefined, signed(2))).toBe(signed(2));
  });

  it('never fetches a photo ahead of time - resolving a URI downloads nothing', () => {
    const prefetch = jest.spyOn(Image, 'prefetch').mockResolvedValue(true);
    for (let id = 1; id <= 40; id++) {
      resolveCollectionIconUri(id, `v${id}`, signed(id));
    }

    expect(prefetch).not.toHaveBeenCalled();
    prefetch.mockRestore();
  });
});

describe('CategoryIconTile with the icon cache', () => {
  function render(element: React.ReactElement) {
    let renderer!: ReactTestRenderer.ReactTestRenderer;
    act(() => {
      renderer = ReactTestRenderer.create(element);
    });
    return renderer;
  }

  it('shows the kept URI for the same photo across responses', () => {
    const first = render(<CategoryIconTile collectionId={42} icon="Folder" imageUrl={signed(1)} imageVersion="v1" />);
    expect(first.root.findByType(Image).props.source).toEqual({ uri: signed(1) });

    const later = render(<CategoryIconTile collectionId={42} icon="Folder" imageUrl={signed(2)} imageVersion="v1" />);
    expect(later.root.findByType(Image).props.source).toEqual({ uri: signed(1) });
  });

  it('expired signed URL no longer cached: falls back to the fresh URL, which then stands for the photo', () => {
    resolveCollectionIconUri(42, 'v1', signed(1));
    const renderer = render(<CategoryIconTile collectionId={42} icon="Folder" imageUrl={signed(2)} imageVersion="v1" />);
    expect(renderer.root.findByType(Image).props.source).toEqual({ uri: signed(1) });

    act(() => {
      renderer.root.findByType(Image).props.onError();
    });

    expect(renderer.root.findByType(Image).props.source).toEqual({ uri: signed(2) });
    expect(resolveCollectionIconUri(42, 'v1', signed(3))).toBe(signed(2));
  });

  it('when neither loads, the built-in glyph is shown - never an empty tile', () => {
    const renderer = render(<CategoryIconTile collectionId={42} icon="Folder" imageUrl={signed(1)} imageVersion="v1" />);

    act(() => {
      renderer.root.findByType(Image).props.onError();
    });

    expect(renderer.root.findAllByType(Image)).toHaveLength(0);
    expect(renderer.root.findAllByType(FolderIcon)).toHaveLength(1);
  });
});
