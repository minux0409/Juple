import i18n from '../../i18n';
import { groupCollectionItemsByDate, sortCollectionItemsByName, sortLinksByName } from '../sortCollectionItems';
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

describe('sortCollectionItemsByName (이름순 over a whole Collection)', () => {
  const titled = (titles: readonly string[]) =>
    titles.map((title, index) => makeItem({ itemId: index + 1, title, addedAtUtc: `2026-01-0${index + 1}T00:00:00Z` }));
  const namesOf = (sorted: readonly CollectionItemEntry[]) => sorted.map(item => item.title);

  it('Korean follows 가나다 order', () => {
    expect(namesOf(sortCollectionItemsByName(titled(['하마', '가방', '나비', '다리']), 'ko'))).toEqual(['가방', '나비', '다리', '하마']);
  });

  it('descending (Z→A) is the exact reverse of the names, with title-less links still last and ties still newest first', () => {
    const items = [
      makeItem({ itemId: 1, title: 'banana', addedAtUtc: '2026-01-01T00:00:00Z' }),
      makeItem({ itemId: 2, title: 'Banana', addedAtUtc: '2026-01-03T00:00:00Z' }),
      makeItem({ itemId: 3, title: 'cherry', addedAtUtc: '2026-01-02T00:00:00Z' }),
      makeItem({ itemId: 4, title: null, url: 'https://zzz.example/x', addedAtUtc: '2026-01-04T00:00:00Z' }),
      makeItem({ itemId: 5, title: 'apple', addedAtUtc: '2026-01-05T00:00:00Z' }),
    ];

    expect(sortCollectionItemsByName(items, 'en', 'asc').map(item => item.itemId)).toEqual([5, 2, 1, 3, 4]);
    // Same-name pair (2, 1) stays newest first in BOTH directions; the title-less link is last in both.
    expect(sortCollectionItemsByName(items, 'en', 'desc').map(item => item.itemId)).toEqual([3, 2, 1, 5, 4]);
    expect(items.map(item => item.itemId)).toEqual([1, 2, 3, 4, 5]);
  });

  it('the one rule serves any link list (Home, Archive search, Trash): same fallback name, same direction semantics', () => {
    const links = [
      { id: 1, title: 'Beta', url: 'https://a.example/1', at: '2026-01-01T00:00:00Z' },
      { id: 2, title: null, url: 'https://alpha.example/2', at: '2026-01-02T00:00:00Z' },
      { id: 3, title: 'Gamma', url: 'https://a.example/3', at: '2026-01-03T00:00:00Z' },
    ];
    const accessors = { title: (link: (typeof links)[number]) => link.title, url: (link: (typeof links)[number]) => link.url, addedAtUtc: (link: (typeof links)[number]) => link.at, id: (link: (typeof links)[number]) => link.id };

    expect(sortLinksByName(links, accessors, 'en').map(link => link.id)).toEqual([1, 3, 2]);
    expect(sortLinksByName(links, accessors, 'en', 'desc').map(link => link.id)).toEqual([3, 1, 2]);
  });

  it('English ignores letter case', () => {
    expect(namesOf(sortCollectionItemsByName(titled(['banana', 'Apple', 'cherry', 'Banana split']), 'en'))).toEqual([
      'Apple',
      'banana',
      'Banana split',
      'cherry',
    ]);
  });

  it('accented Latin letters sort with their base letter, not after z', () => {
    expect(namesOf(sortCollectionItemsByName(titled(['Zoo', 'École', 'Eagle', 'édition']), 'fr'))).toEqual(['Eagle', 'École', 'édition', 'Zoo']);
  });

  it('numbers compare by value', () => {
    expect(namesOf(sortCollectionItemsByName(titled(['Item 10', 'Item 2', 'Item 1']), 'en'))).toEqual(['Item 1', 'Item 2', 'Item 10']);
  });

  it('an untitled link sorts by the site name its row shows, after every titled link', () => {
    const sorted = sortCollectionItemsByName(
      [
        makeItem({ itemId: 1, title: null, url: 'https://www.zeta.example/a' }),
        makeItem({ itemId: 2, title: null, url: 'https://alpha.example/b' }),
        makeItem({ itemId: 3, title: 'Middle' }),
      ],
      'en',
    );
    expect(sorted.map(item => item.itemId)).toEqual([3, 2, 1]);
  });

  it('equal names keep a stable order (newest first, then id)', () => {
    const sorted = sortCollectionItemsByName(
      [
        makeItem({ itemId: 1, title: 'Same', addedAtUtc: '2026-01-01T00:00:00Z' }),
        makeItem({ itemId: 3, title: 'same', addedAtUtc: '2026-01-02T00:00:00Z' }),
        makeItem({ itemId: 2, title: 'Same', addedAtUtc: '2026-01-02T00:00:00Z' }),
      ],
      'en',
    );
    expect(sorted.map(item => item.itemId)).toEqual([3, 2, 1]);
  });

  it('an unsupported or malformed language tag falls back instead of crashing', () => {
    const unsorted = titled(['b', 'a']);
    expect(namesOf(sortCollectionItemsByName(unsorted, 'xx-Unknown'))).toEqual(['a', 'b']);
    expect(namesOf(sortCollectionItemsByName(unsorted, '!!not a tag!!'))).toEqual(['a', 'b']);
  });

  it('never mutates the input array', () => {
    const items = titled(['b', 'a']);
    const original = [...items];
    sortCollectionItemsByName(items, 'en');
    expect(items).toEqual(original);
  });
});

describe('groupCollectionItemsByDate (시간순 accordion over the server order)', () => {
  const t = i18n.t.bind(i18n);
  const daysAgo = (days: number) => {
    const date = new Date();
    date.setHours(12, 0, 0, 0);
    date.setDate(date.getDate() - days);
    return date.toISOString();
  };
  const monthsAgo = (months: number, day: number) => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth() - months, day, 12).toISOString();
  };
  // As the server returns them for dateDesc (newest first) - dateAsc is the same links reversed.
  const newestFirst = [
    makeItem({ itemId: 1, addedAtUtc: daysAgo(0) }),
    makeItem({ itemId: 2, addedAtUtc: daysAgo(1) }),
    makeItem({ itemId: 4, addedAtUtc: monthsAgo(2, 20) }),
    makeItem({ itemId: 3, addedAtUtc: monthsAgo(2, 5) }),
    makeItem({ itemId: 5, addedAtUtc: monthsAgo(3, 10) }),
  ];
  const oldestFirst = [...newestFirst].reverse();

  beforeAll(async () => {
    await i18n.changeLanguage('ko');
  });

  it('dateDesc: 오늘 → 어제 → recent month → older month, newest first inside each', () => {
    const sections = groupCollectionItemsByDate(newestFirst, 'dateDesc', t);
    expect(sections.map(section => section.label).slice(0, 2)).toEqual([t('history.today'), t('history.yesterday')]);
    expect(sections.map(section => section.items.map(item => item.itemId))).toEqual([[1], [2], [4, 3], [5]]);
    expect(sections[2].dateKey).toMatch(/^month:/);
  });

  it('dateAsc: the exact reverse - oldest month first, 오늘 last, oldest first inside each - straight from the server order', () => {
    const sections = groupCollectionItemsByDate(oldestFirst, 'dateAsc', t);
    expect(sections.map(section => section.items.map(item => item.itemId))).toEqual([[5], [3, 4], [2], [1]]);
    expect(sections[sections.length - 1].label).toBe(t('history.today'));
  });

  it('keeps the same section keys in both directions, so open/closed sections survive a toggle', () => {
    const newest = groupCollectionItemsByDate(newestFirst, 'dateDesc', t).map(section => section.dateKey);
    const oldest = groupCollectionItemsByDate(oldestFirst, 'dateAsc', t).map(section => section.dateKey);
    expect([...oldest].reverse()).toEqual(newest);
  });

  it('uses exactly History\'s buckets (오늘 / 어제 / 이번 주 / months) - the same helper, no Collection-only group', () => {
    const labels = groupCollectionItemsByDate(newestFirst, 'dateDesc', t).map(section => section.label);
    const allowed = new Set([t('history.today'), t('history.yesterday'), t('history.thisWeek')]);
    labels.slice(2).forEach(label => expect(allowed.has(label)).toBe(false));
  });
});
