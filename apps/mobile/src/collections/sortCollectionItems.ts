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
  return sortLinksByName(items, { title: a => a.title, url: a => a.url, addedAtUtc: a => a.addedAtUtc, id: a => a.itemId }, locale);
}

/** What the name order reads from a link of any list (a Collection's entry, a Home/History item). */
export interface LinkNameAccessors<T> {
  readonly title: (link: T) => string | null;
  readonly url: (link: T) => string;
  readonly addedAtUtc: (link: T) => string;
  readonly id: (link: T) => number;
}

/**
 * The one 이름순 rule (see sortCollectionItemsByName), for any link list - a Collection and Home
 * order names identically: locale-aware, title-less links last, ties newest first, never mutating.
 */
export function sortLinksByName<T>(
  items: readonly T[],
  accessors: LinkNameAccessors<T>,
  locale: string | undefined = i18n.language,
): readonly T[] {
  const collator = createNameCollator(locale);
  return [...items].sort((a, b) => {
    if ((accessors.title(a) === null) !== (accessors.title(b) === null)) {
      return accessors.title(a) === null ? 1 : -1;
    }
    return (
      collator.compare(
        resolveSavedLinkPrimaryText(accessors.title(a), accessors.url(a)),
        resolveSavedLinkPrimaryText(accessors.title(b), accessors.url(b)),
      )
      // Same name (or equal under base sensitivity): newest first, so the order never shuffles.
      || accessors.addedAtUtc(b).localeCompare(accessors.addedAtUtc(a))
      || accessors.id(b) - accessors.id(a)
    );
  });
}

/**
 * Collections by name - the same locale-aware compare as sortCollectionItemsByName. Like that one,
 * only for a WHOLE list (every page loaded), never for some pages. Same name: newest first. Never
 * mutates the input.
 */
export function sortCollectionsByName<T extends { readonly id: number; readonly name: string; readonly createdAtUtc: string }>(
  collections: readonly T[],
  locale: string | undefined = i18n.language,
): readonly T[] {
  const collator = createNameCollator(locale);
  return [...collections].sort(
    (a, b) => collator.compare(a.name, b.name) || b.createdAtUtc.localeCompare(a.createdAtUtc) || b.id - a.id,
  );
}

/**
 * 시간순 as History's own date accordion (see groupByLocalDate - one grouping rule, never a second
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
