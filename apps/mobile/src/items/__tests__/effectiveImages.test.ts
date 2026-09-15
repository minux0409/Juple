import {
  buildEffectiveImages,
  coverImageIdForFront,
  effectiveImageKey,
  effectiveImageUrl,
  isDeletable,
  reorderList,
} from '../effectiveImages';
import type { ItemImage } from '../../images/api/imagesApi';

function makeImage(overrides: Partial<ItemImage> = {}): ItemImage {
  return {
    id: 1,
    contentType: 'image/jpeg',
    byteLength: 1000,
    sortOrder: 0,
    createdAtUtc: new Date().toISOString(),
    readUrl: 'https://blob.example/1.jpg',
    ...overrides,
  };
}

describe('buildEffectiveImages', () => {
  it('preview only: returns a single auto entry', () => {
    const list = buildEffectiveImages('https://cdn.example/preview.jpg', [], null);

    expect(list).toEqual([{ kind: 'auto', url: 'https://cdn.example/preview.jpg' }]);
  });

  it('user only: returns a single uploaded entry', () => {
    const image = makeImage({ id: 7 });
    const list = buildEffectiveImages(null, [image], null);

    expect(list).toEqual([{ kind: 'uploaded', image }]);
  });

  it('preview + user: both are shown, auto first by default', () => {
    const image = makeImage({ id: 7 });
    const list = buildEffectiveImages('https://cdn.example/preview.jpg', [image], null);

    expect(list).toEqual([
      { kind: 'auto', url: 'https://cdn.example/preview.jpg' },
      { kind: 'uploaded', image },
    ]);
  });

  it('neither preview nor user images: returns an empty list', () => {
    expect(buildEffectiveImages(null, [], null)).toEqual([]);
  });

  it('user image selected as cover: moves it to the front, keeping the preview visible', () => {
    const image = makeImage({ id: 7 });
    const list = buildEffectiveImages('https://cdn.example/preview.jpg', [image], 7);

    expect(list).toEqual([
      { kind: 'uploaded', image },
      { kind: 'auto', url: 'https://cdn.example/preview.jpg' },
    ]);
  });

  it('cover cleared (null): reverts to auto-first, both images still shown', () => {
    const image = makeImage({ id: 7 });
    const list = buildEffectiveImages('https://cdn.example/preview.jpg', [image], null);

    expect(list).toEqual([
      { kind: 'auto', url: 'https://cdn.example/preview.jpg' },
      { kind: 'uploaded', image },
    ]);
  });

  it('cannot set another Item\'s image as cover: an unknown coverImageId is ignored, base order kept', () => {
    const image = makeImage({ id: 7 });
    const list = buildEffectiveImages('https://cdn.example/preview.jpg', [image], 999);

    expect(list).toEqual([
      { kind: 'auto', url: 'https://cdn.example/preview.jpg' },
      { kind: 'uploaded', image },
    ]);
  });

  it('two uploaded images, no preview: natural SortOrder order by default', () => {
    const first = makeImage({ id: 1, sortOrder: 0 });
    const second = makeImage({ id: 2, sortOrder: 1 });
    const list = buildEffectiveImages(null, [first, second], null);

    expect(list).toEqual([
      { kind: 'uploaded', image: first },
      { kind: 'uploaded', image: second },
    ]);
  });

  it('two uploaded images, no preview: cover moves the second one to the front', () => {
    const first = makeImage({ id: 1, sortOrder: 0 });
    const second = makeImage({ id: 2, sortOrder: 1 });
    const list = buildEffectiveImages(null, [first, second], 2);

    expect(list).toEqual([
      { kind: 'uploaded', image: second },
      { kind: 'uploaded', image: first },
    ]);
  });

  it('legacy Item with more than 2 uploaded images: all are returned, never truncated', () => {
    const images = [makeImage({ id: 1 }), makeImage({ id: 2 }), makeImage({ id: 3 }), makeImage({ id: 4 })];
    const list = buildEffectiveImages(null, images, null);

    expect(list).toHaveLength(4);
  });
});

describe('reorderList', () => {
  it('moves an item from one index to another, splice semantics', () => {
    expect(reorderList(['a', 'b'], 1, 0)).toEqual(['b', 'a']);
    expect(reorderList(['a', 'b'], 0, 1)).toEqual(['b', 'a']);
  });

  it('is a no-op when fromIndex equals toIndex', () => {
    expect(reorderList(['a', 'b'], 0, 0)).toEqual(['a', 'b']);
  });
});

describe('coverImageIdForFront', () => {
  it('returns null when the front is the auto entry', () => {
    const image = makeImage({ id: 7 });
    const list = buildEffectiveImages('https://cdn.example/preview.jpg', [image], null);

    expect(coverImageIdForFront(list)).toBeNull();
  });

  it('returns the uploaded image id when it is at the front', () => {
    const image = makeImage({ id: 7 });
    const list = [{ kind: 'uploaded', image } as const];

    expect(coverImageIdForFront(list)).toBe(7);
  });

  it('returns null for an empty list', () => {
    expect(coverImageIdForFront([])).toBeNull();
  });
});

describe('effectiveImageUrl', () => {
  it('resolves each kind to its own url', () => {
    const image = makeImage({ readUrl: 'https://blob.example/x.jpg' });
    expect(effectiveImageUrl({ kind: 'auto', url: 'https://cdn.example/a.jpg' })).toBe('https://cdn.example/a.jpg');
    expect(effectiveImageUrl({ kind: 'uploaded', image })).toBe('https://blob.example/x.jpg');
    expect(effectiveImageUrl({ kind: 'staged', stagedId: 's1', localUri: 'file:///tmp/a.jpg' })).toBe(
      'file:///tmp/a.jpg',
    );
  });

  it('returns null for an uploaded image with no resolved read URL', () => {
    const image = makeImage({ readUrl: null });
    expect(effectiveImageUrl({ kind: 'uploaded', image })).toBeNull();
  });
});

describe('effectiveImageKey', () => {
  it('is stable and distinguishable across kinds', () => {
    const image = makeImage({ id: 7 });
    expect(effectiveImageKey({ kind: 'auto', url: 'https://cdn.example/a.jpg' })).toBe('auto');
    expect(effectiveImageKey({ kind: 'uploaded', image })).toBe('uploaded-7');
    expect(effectiveImageKey({ kind: 'staged', stagedId: 's1', localUri: 'file:///tmp/a.jpg' })).toBe('staged-s1');
  });
});

describe('isDeletable', () => {
  it('is false only for the auto entry', () => {
    const image = makeImage();
    expect(isDeletable({ kind: 'auto', url: 'https://cdn.example/a.jpg' })).toBe(false);
    expect(isDeletable({ kind: 'uploaded', image })).toBe(true);
    expect(isDeletable({ kind: 'staged', stagedId: 's1', localUri: 'file:///tmp/a.jpg' })).toBe(true);
  });
});
