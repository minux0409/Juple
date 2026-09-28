import type { TFunction } from 'i18next';
import i18n from '../i18n';
import { groupByLocalDate, type HistorySection } from '../items/historyDateGrouping';
import { resolveSavedLinkPrimaryText } from '../items/savedLinkPrimaryText';
import type { CollectionItemsSort, CollectionItemEntry } from './api/collectionsApi';

/**
 * A comparer for the app's current language: accents and letter case only break ties (base
 * sensitivity), and digit runs compare by value ("Item 2" before "Item 10"). An unknown or
 * malformed language tag falls back to the runtime's default collation rather than throwing.
 */
function createNameCollator(locale: string | undefined): Intl.Collator {
  const options: Intl.CollatorOptions = { numeric: true, sensitivity: 'base' };
  try {
    return new Intl.Collator(locale, options);
  } catch {
    return new Intl.Collator(undefined, options);
  }
}

/**
 * 이름순: a locale-aware compare in the app's current language (see createNameCollator) over what
 * each row shows as its name; title-less links (shown by their site name - see
 * resolveSavedLinkPrimaryText) come after every titled link, never mixed in. Only ever applied to a
 * WHOLE Collection (useCollectionItems' 'whole' mode) - over some loaded pages it would present a
 * partial order as the Collection's. One flat list: initial-letter grouping differs per language
 * and is not designed yet. Never mutates the input.
 */
export function sortCollectionItemsByName(
  items: readonly CollectionItemEntry[],
  locale: string | undefined = i18n.language,
): readonly CollectionItemEntry[] {
  const collator = createNameCollator(locale);
  return [...items].sort((a, b) => {
    if ((a.title === null) !== (b.title === null)) {
      return a.title === null ? 1 : -1;
    }
    return (
      collator.compare(resolveSavedLinkPrimaryText(a.title, a.url), resolveSavedLinkPrimaryText(b.title, b.url))
      // Same name (or equal under base sensitivity): newest first, so the order never shuffles.
      || b.addedAtUtc.localeCompare(a.addedAtUtc)
      || b.itemId - a.itemId
    );
  });
}

/**
 * 일자순 as History's own date accordion (see groupByLocalDate - one grouping rule, never a second
 * copy): the links arrive already in the server's order for `sort` (the whole Collection by
 * AddedAtUtc), so 'dateDesc' reads 오늘 → 어제 → 이번 주 → newer months → older months and 'dateAsc'
 * the exact reverse, each section in the same direction. Nothing is re-sorted here.
 */
export function groupCollectionItemsByDate(
  items: readonly CollectionItemEntry[],
  sort: CollectionItemsSort,
  t: TFunction,
): readonly HistorySection<CollectionItemEntry>[] {
  return groupByLocalDate(items, t, item => item.addedAtUtc, sort === 'dateAsc' ? 'oldestFirst' : 'newestFirst');
}
