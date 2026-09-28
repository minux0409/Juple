import i18n from '../../i18n';
import { groupCollectionItemsByDate, sortCollectionItemsByName } from '../sortCollectionItems';
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

describe('groupCollectionItemsByDate (일자순 accordion over the server order)', () => {
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
