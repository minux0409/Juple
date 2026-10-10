import { chunkIntoImageLines } from '../../components/SavedLinkImageTile';
import { buildDateSectionRows } from '../../components/DateSectionList';
import { buildFlatItemRows } from '../../items/flatItemRows';
import type { DateSection, DateSectionPage } from '../../items/useDateSectionPages';
import { getSavedLinkColumns, PHONE_SAVED_LINK_COLUMNS } from '../responsiveGrid';

const ids = Array.from({ length: 9 }, (_, index) => ({ id: index + 1 }));
const idOf = (item: { id: number }) => item.id;
const sizes = (rows: readonly object[]) => rows.map(row => (row as { items?: readonly unknown[] }).items?.length);

describe('row builders take the responsive column counts', () => {
  it('default to the phone layout: pairs of cards and lines of three tiles', () => {
    expect(sizes(buildFlatItemRows(ids, 'grid', { idOf }))).toEqual([2, 2, 2, 2, 1]);
    expect(sizes(buildFlatItemRows(ids, 'image', { idOf }))).toEqual([3, 3, 3]);
    expect(chunkIntoImageLines(ids).map(line => line.length)).toEqual([3, 3, 3]);
    expect(PHONE_SAVED_LINK_COLUMNS).toEqual({ grid: 2, image: 3 });
  });

  it('flat Grid / Image rows use the window\'s counts', () => {
    const small = getSavedLinkColumns({ width: 800, height: 1280 });
    expect(sizes(buildFlatItemRows(ids, 'grid', { idOf }, small))).toEqual([4, 4, 1]);
    expect(sizes(buildFlatItemRows(ids, 'image', { idOf }, small))).toEqual([6, 3]);
    const large = getSavedLinkColumns({ width: 1280, height: 800 });
    expect(sizes(buildFlatItemRows(ids, 'grid', { idOf }, large))).toEqual([6, 3]);
    expect(sizes(buildFlatItemRows(ids, 'image', { idOf }, large))).toEqual([8, 1]);
  });

  it('keeps each flat row keyed by its first link, so a column change never reuses a key for a different line', () => {
    const phone = buildFlatItemRows(ids, 'grid', { idOf });
    const tablet = buildFlatItemRows(ids, 'grid', { idOf }, getSavedLinkColumns({ width: 800, height: 1280 }));
    expect(new Set(phone.map(row => row.key)).size).toBe(phone.length);
    expect(new Set(tablet.map(row => row.key)).size).toBe(tablet.length);
  });

  it('a date section builds grid rows, image lines and skeleton rows for the window\'s counts', () => {
    const section = { key: 'd1', count: 9 } as unknown as DateSection;
    const page = { items: ids, isLoading: false, isLoadingMore: false, nextCursor: null, error: null } as unknown as DateSectionPage<{ id: number }>;
    const rowsFor = (mode: 'grid' | 'image', columns = PHONE_SAVED_LINK_COLUMNS) =>
      buildDateSectionRows([section], new Map([['d1', page]]), new Set(['d1']), mode, idOf, columns).filter(row => row.kind === 'gridRow' || row.kind === 'imageRow');
    expect(sizes(rowsFor('grid'))).toEqual([2, 2, 2, 2, 1]);
    expect(sizes(rowsFor('grid', getSavedLinkColumns({ width: 1280, height: 800 })))).toEqual([6, 3]);
    expect(sizes(rowsFor('image', getSavedLinkColumns({ width: 800, height: 1280 })))).toEqual([6, 3]);

    // First-page skeletons cover the same share of the first screen: 6 placeholders = 3 lines of 2, 2 of 4, 1 of 6.
    const loading = { items: [], isLoading: true, isLoadingMore: false, nextCursor: null, error: null } as unknown as DateSectionPage<{ id: number }>;
    const skeletonCount = (columns: { grid: number; image: number }) =>
      buildDateSectionRows([section], new Map([['d1', loading]]), new Set(['d1']), 'grid', idOf, columns).filter(row => row.kind === 'skeleton').length;
    expect(skeletonCount(PHONE_SAVED_LINK_COLUMNS)).toBe(3);
    expect(skeletonCount(getSavedLinkColumns({ width: 800, height: 1280 }))).toBe(2);
    expect(skeletonCount(getSavedLinkColumns({ width: 1280, height: 800 }))).toBe(1);
  });
});
