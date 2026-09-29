import { useRef, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, Text, View, type ListViewToken } from 'react-native';
import type { DateSection, DateSectionPage } from '../items/useDateSectionPages';
import { colors, minTouchTarget, spacing } from '../theme/tokens';
import { dateAccordionStyles } from './DateAccordion';
import { SavedLinkGridCardSkeleton, SavedLinkRowSkeleton } from './SavedLinkSkeleton';

/** Skeleton rows while a section's first page loads (never more than the section holds). */
export const FIRST_PAGE_SKELETON_ROWS = 6;
/** Skeleton rows under the loaded ones while a section's next page loads. */
export const NEXT_PAGE_SKELETON_ROWS = 2;
/** A section's next page is requested once a row this close to its loaded end is on screen. */
export const NEAR_END_ROWS = 8;
/** Tiles per virtualized row in image view. */
export const DATE_SECTION_GRID_COLUMNS = 2;

/**
 * One row of a single date-grouped list (History, a Collection's 일자순). Only expanded sections
 * contribute anything below their header, and only what they have loaded (plus skeletons while a
 * request is actually on its way) - so the list's length follows what the user opened, never how
 * many links exist.
 */
export type DateSectionRow<T> =
  | { readonly kind: 'header'; readonly key: string; readonly section: DateSection }
  | { readonly kind: 'item'; readonly key: string; readonly section: DateSection; readonly item: T; readonly position: number; readonly isLast: boolean }
  | { readonly kind: 'gridRow'; readonly key: string; readonly section: DateSection; readonly items: readonly T[]; readonly position: number; readonly isFirst: boolean; readonly isLast: boolean }
  | { readonly kind: 'skeleton'; readonly key: string; readonly section: DateSection; readonly grid: boolean; readonly isFirst: boolean; readonly isLast: boolean }
  | { readonly kind: 'error'; readonly key: string; readonly section: DateSection; readonly message: string };

/** The flat rows for the current sections, expansion and loaded pages (pure - see DateSectionRow). */
export function buildDateSectionRows<T>(
  sections: readonly DateSection[],
  pages: ReadonlyMap<string, DateSectionPage<T>>,
  expandedKeys: ReadonlySet<string>,
  viewMode: 'list' | 'grid',
  idOf: (item: T) => number,
): readonly DateSectionRow<T>[] {
  const rows: DateSectionRow<T>[] = [];
  for (const section of sections) {
    rows.push({ kind: 'header', key: `h:${section.key}`, section });
    if (!expandedKeys.has(section.key)) {
      continue;
    }
    const page = pages.get(section.key);
    const items = page?.items ?? [];
    const firstLoad = !page || (page.isLoading && items.length === 0);
    const body: DateSectionRow<T>[] = [];
    const grid = viewMode === 'grid';

    if (grid) {
      for (let index = 0; index < items.length; index += DATE_SECTION_GRID_COLUMNS) {
        body.push({ kind: 'gridRow', key: `g:${section.key}:${idOf(items[index])}`, section, items: items.slice(index, index + DATE_SECTION_GRID_COLUMNS), position: index, isFirst: false, isLast: false });
      }
    } else {
      items.forEach((item, position) => body.push({ kind: 'item', key: `i:${idOf(item)}`, section, item, position, isLast: false }));
    }

    // Only while a request is actually on its way: a screenful for a first page, a couple under
    // the loaded rows for a next one - never just because more exist (see NEAR_END_ROWS).
    const skeletons = firstLoad
      ? Math.min(section.count, FIRST_PAGE_SKELETON_ROWS)
      : page.isLoadingMore
        ? NEXT_PAGE_SKELETON_ROWS
        : 0;
    const skeletonRows = grid ? Math.ceil(skeletons / DATE_SECTION_GRID_COLUMNS) : skeletons;
    for (let index = 0; index < skeletonRows; index++) {
      body.push({ kind: 'skeleton', key: `s:${section.key}:${index}`, section, grid, isFirst: false, isLast: false });
    }
    if (page?.error) {
      body.push({ kind: 'error', key: `e:${section.key}`, section, message: page.error });
    }

    body.forEach((row, index) => {
      const isFirst = index === 0;
      const isLast = index === body.length - 1;
      if (row.kind === 'gridRow' || row.kind === 'skeleton') {
        rows.push({ ...row, isFirst, isLast });
      } else if (row.kind === 'item') {
        rows.push({ ...row, isLast });
      } else {
        rows.push(row);
      }
    });
  }
  return rows;
}

/**
 * The FlatList viewability props that page each section on its own: a section's next page is asked
 * for once one of its last NEAR_END_ROWS loaded links (or its skeleton rows) comes on screen - only
 * for that section, and only while it has more. The callbacks are stable (FlatList requires it) and
 * always read the latest pages/loadMore.
 */
export function useDateSectionViewability<T>(
  pages: ReadonlyMap<string, DateSectionPage<T>>,
  loadMore: (key: string) => void,
) {
  const pagesRef = useRef(pages);
  pagesRef.current = pages;
  const loadMoreRef = useRef(loadMore);
  loadMoreRef.current = loadMore;
  const onViewableItemsChanged = useRef(({ viewableItems }: { viewableItems: readonly ListViewToken[] }) => {
    const wanted = new Set<string>();
    for (const token of viewableItems) {
      const row = token.item as DateSectionRow<T> | undefined;
      if (!row || row.kind === 'header' || row.kind === 'error') {
        continue;
      }
      const page = pagesRef.current.get(row.section.key);
      if (!page?.nextCursor) {
        continue;
      }
      const reached = row.kind === 'skeleton' ? page.items.length : row.position + (row.kind === 'gridRow' ? row.items.length : 1);
      if (page.items.length - reached < NEAR_END_ROWS) {
        wanted.add(row.section.key);
      }
    }
    wanted.forEach(key => loadMoreRef.current(key));
  }).current;
  const viewabilityConfig = useRef({ itemVisiblePercentThreshold: 10, minimumViewTime: 0 }).current;
  return { onViewableItemsChanged, viewabilityConfig };
}

interface CardRowPosition {
  readonly isFirst: boolean;
  readonly isLast: boolean;
}

/** Image view: one line of tiles in a section's card (the first opens the body, the last closes it). */
export function DateSectionGridRow({ isFirst, isLast, testID, children }: CardRowPosition & { readonly testID?: string; readonly children: ReactNode }) {
  return (
    <View style={[dateAccordionStyles.gridRow, isFirst && dateAccordionStyles.gridRowFirst, isLast && dateAccordionStyles.gridRowLast]} testID={testID}>
      {children}
    </View>
  );
}

/** Where a link is about to appear while its page loads - a list row, or a line of grid tiles. */
export function DateSectionSkeletonRow({ grid, isFirst, isLast, testID }: CardRowPosition & { readonly grid: boolean; readonly testID: string }) {
  return grid ? (
    <DateSectionGridRow isFirst={isFirst} isLast={isLast}>
      {Array.from({ length: DATE_SECTION_GRID_COLUMNS }, (_, index) => (
        <View key={index} style={styles.gridSkeletonCell}>
          <SavedLinkGridCardSkeleton testID={testID} />
        </View>
      ))}
    </DateSectionGridRow>
  ) : (
    <View style={[dateAccordionStyles.row, styles.skeletonRow, isLast && dateAccordionStyles.rowLast]}>
      <SavedLinkRowSkeleton testID={testID} />
    </View>
  );
}

/** A section whose page failed: the message and a retry that asks for exactly that page again. */
export function DateSectionErrorRow({ message, onRetry, testID, retryTestID }: { readonly message: string; readonly onRetry: () => void; readonly testID: string; readonly retryTestID: string }) {
  const { t } = useTranslation();
  return (
    <View style={[dateAccordionStyles.row, dateAccordionStyles.rowLast, styles.errorRow]} testID={testID}>
      <Text style={styles.errorRowText}>{message}</Text>
      <Pressable accessibilityRole="button" onPress={onRetry} style={styles.retryButton} testID={retryTestID}>
        <Text style={styles.retryLabel}>{t('history.retry')}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  skeletonRow: { backgroundColor: colors.surface, overflow: 'hidden' },
  gridSkeletonCell: { flexBasis: '50%', maxWidth: '50%', paddingHorizontal: 2 },
  errorRow: { alignItems: 'center', backgroundColor: colors.surface, flexDirection: 'row', gap: spacing.sm, padding: spacing.md },
  errorRowText: { color: colors.danger, flex: 1, fontSize: 14 },
  retryButton: { alignItems: 'center', justifyContent: 'center', minHeight: minTouchTarget, paddingHorizontal: spacing.md },
  retryLabel: { color: colors.brand, fontSize: 14, fontWeight: '700' },
});
