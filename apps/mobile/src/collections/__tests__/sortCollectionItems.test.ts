import { sortCollectionItems } from '../sortCollectionItems';
import type { CollectionItemEntry } from '../api/collectionsApi';

function makeItem(overrides: Partial<CollectionItemEntry>): CollectionItemEntry {
  return {
    itemId: 1,
    url: 'https://example.com',
    title: null,
    memo: null,
    addedAtUtc: '2026-01-01T00:00:00Z',
    sortOrder: 0,
    representativeImage: null,
    previewImageUrl: null,
    coverImage: null,
    ...overrides,
  };
}

describe('sortCollectionItems', () => {
  const items = [
    makeItem({ itemId: 1, title: 'Banana', addedAtUtc: '2026-01-02T00:00:00Z' }),
    makeItem({ itemId: 2, title: 'Apple', addedAtUtc: '2026-01-03T00:00:00Z' }),
    makeItem({ itemId: 3, title: 'Cherry', addedAtUtc: '2026-01-01T00:00:00Z' }),
  ];

  it('newest sorts by addedAtUtc descending', () => {
    expect(sortCollectionItems(items, 'newest').map(item => item.itemId)).toEqual([2, 1, 3]);
  });

  it('oldest sorts by addedAtUtc ascending', () => {
    expect(sortCollectionItems(items, 'oldest').map(item => item.itemId)).toEqual([3, 1, 2]);
  });

  it('title sorts alphabetically', () => {
    expect(sortCollectionItems(items, 'title').map(item => item.itemId)).toEqual([2, 1, 3]);
  });

  it('title sort pushes title-less items after every titled item, never mixed in arbitrarily', () => {
    const withUntitled = [
      makeItem({ itemId: 10, title: null }),
      makeItem({ itemId: 11, title: 'Zebra' }),
      makeItem({ itemId: 12, title: 'Apple' }),
    ];
    expect(sortCollectionItems(withUntitled, 'title').map(item => item.itemId)).toEqual([12, 11, 10]);
  });

  it('never mutates the input array', () => {
    const original = [...items];
    sortCollectionItems(items, 'oldest');
    expect(items).toEqual(original);
  });
});
