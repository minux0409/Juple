import { chunkIntoImageLines } from '../components/SavedLinkImageTile';
import type { SavedLinkViewMode } from '../settings/viewModePreference';

/**
 * The rows of a flat, server-paged list of links - the Archive's search results and 이름순, a Collection's search
 * results and 이름순 Image view: links as list rows, lines of two tiles (Grid) or lines of three image tiles (Image).
 * Generic over the link type, so no screen packs its own lines.
 */
export type FlatItemRow<T> =
  | { readonly kind: 'flatItem'; readonly key: string; readonly item: T; readonly dateDisplayMode: 'dateTime' }
  | { readonly kind: 'flatGridRow'; readonly key: string; readonly items: readonly T[]; readonly dateDisplayMode: 'dateTime' }
  | { readonly kind: 'flatImageRow'; readonly key: string; readonly items: readonly T[] };

export interface FlatItemAccessors<T> {
  readonly idOf: (item: T) => number;
}

/**
 * Links as flat rows, in the order given (the server's): one per link in List, one per pair of tiles in Grid, one per
 * three tiles in Image - the last line may be short. Each row is keyed by its first link, so a page boundary never
 * reshuffles the lines already shown. A flat list has no date context, so rows always show the full date.
 */
export function buildFlatItemRows<T>(items: readonly T[], viewMode: SavedLinkViewMode, { idOf }: FlatItemAccessors<T>): readonly FlatItemRow<T>[] {
  if (viewMode === 'image') {
    return chunkIntoImageLines(items).map(line => ({ kind: 'flatImageRow', key: `fm:${idOf(line[0])}`, items: line }));
  }
  if (viewMode === 'grid') {
    const rowsOut: FlatItemRow<T>[] = [];
    for (let index = 0; index < items.length; index += 2) {
      const pair = items.slice(index, index + 2);
      rowsOut.push({ kind: 'flatGridRow', key: `fg:${idOf(pair[0])}`, items: pair, dateDisplayMode: 'dateTime' });
    }
    return rowsOut;
  }
  return items.map(item => ({ kind: 'flatItem', key: `fi:${idOf(item)}`, item, dateDisplayMode: 'dateTime' }));
}
