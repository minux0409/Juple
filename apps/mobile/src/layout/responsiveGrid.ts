import { useMemo } from 'react';
import { useWindowDimensions } from 'react-native';

/**
 * Responsive Grid columns - the ONE place a screen's column count is decided. Phones keep exactly the column counts they always
 * had, in portrait AND landscape; a tablet-class window gets MORE columns as it widens instead of ever-wider cards.
 *
 * Phone vs tablet is decided by the window's SHORTEST side, not its width: a phone turned sideways is wide (891 x 411) but its
 * short side stays a phone's, while every real tablet - 7" (600 x 960), 10" (800 x 1280), an unfolded foldable (~673 x 841) - has a
 * short side of at least 600dp (the Material "medium window" threshold). It is read from the app WINDOW (useWindowDimensions), so
 * split-screen and resizing are followed live and nothing is read once at module load: a tablet in a narrow split-screen window
 * is a phone-sized window and gets the phone layout.
 *
 * Tablet columns come from the width actually available: as many columns as keep each cell at least `minCellWidth` wide, never
 * fewer than `minTabletColumns` and never more than `maxColumns` (so cells neither balloon on a 10" landscape nor shrink into
 * specks on a very wide window).
 */
export const TABLET_MIN_SHORTEST_SIDE = 600;
/** Horizontal screen padding (both sides) a grid sits inside - used to turn the window width into the grid's width. */
export const GRID_SCREEN_SIDE_PADDING = 32;

export type DeviceClass = 'phone' | 'tablet';

export interface WindowSize {
  readonly width: number;
  readonly height: number;
}

export function getDeviceClass({ width, height }: WindowSize): DeviceClass {
  return Math.min(width, height) >= TABLET_MIN_SHORTEST_SIDE ? 'tablet' : 'phone';
}

export interface GridSurface {
  /** The column count on a phone, in either orientation. Never changes. */
  readonly phone: number;
  /** A tablet never shows fewer columns than this. */
  readonly minTabletColumns: number;
  /** A tablet never shows more columns than this. */
  readonly maxColumns: number;
  /** A tablet adds columns while each cell would stay at least this wide (dp). */
  readonly minCellWidth: number;
}

export function getResponsiveColumnCount(window: WindowSize, surface: GridSurface, maxContentWidth: number = Number.POSITIVE_INFINITY): number {
  if (getDeviceClass(window) === 'phone') {
    return surface.phone;
  }
  const available = Math.min(window.width, maxContentWidth) - GRID_SCREEN_SIDE_PADDING;
  const fitting = Math.floor(available / surface.minCellWidth);
  return Math.max(surface.minTabletColumns, Math.min(surface.maxColumns, fitting));
}

/**
 * Per surface. The phone values are what the screens used before this became responsive and must not change.
 * - Link cards (Home, History, a Collection, Trash, Friends): phone 2; a cell stays >= 180dp, 3..6 columns.
 * - Image tiles (the image-only view): phone 3; >= 110dp, 5..8 columns.
 * - Collection tiles (Collections tab, the Collection picker): phone 4; >= 110dp, 5..8 columns.
 */
export const SAVED_LINK_GRID_SURFACE: GridSurface = { phone: 2, minTabletColumns: 3, maxColumns: 6, minCellWidth: 180 };
export const SAVED_LINK_IMAGE_SURFACE: GridSurface = { phone: 3, minTabletColumns: 5, maxColumns: 8, minCellWidth: 110 };
export const COLLECTION_TILE_SURFACE: GridSurface = { phone: 4, minTabletColumns: 5, maxColumns: 8, minCellWidth: 110 };

/** The link-column counts a row builder lays its lines out with (pure builders take this instead of reading the window). */
export interface SavedLinkColumns {
  readonly grid: number;
  readonly image: number;
}

export const PHONE_SAVED_LINK_COLUMNS: SavedLinkColumns = {
  grid: SAVED_LINK_GRID_SURFACE.phone,
  image: SAVED_LINK_IMAGE_SURFACE.phone,
};

export function getSavedLinkColumns(window: WindowSize): SavedLinkColumns {
  return {
    grid: getResponsiveColumnCount(window, SAVED_LINK_GRID_SURFACE),
    image: getResponsiveColumnCount(window, SAVED_LINK_IMAGE_SURFACE),
  };
}

/** The current window's link columns; the object is stable until a count actually changes (safe in memo dependencies). */
export function useSavedLinkColumns(): SavedLinkColumns {
  const window = useWindowDimensions();
  const { grid, image } = getSavedLinkColumns(window);
  return useMemo(() => ({ grid, image }), [grid, image]);
}

/** `maxContentWidth`: the widest the grid can actually be (a bottom sheet is capped), so tiles never shrink below the minimum there. */
export function useCollectionTileColumns(maxContentWidth?: number): number {
  const window = useWindowDimensions();
  return getResponsiveColumnCount(window, COLLECTION_TILE_SURFACE, maxContentWidth);
}

/** One cell's width as a share of its row: `100 / columns` percent (2 -> '50%', exactly what the 2-column cells always used). */
export function columnBasis(columns: number): `${number}%` {
  return `${100 / columns}%`;
}

/**
 * A FlatList cannot change `numColumns` on the fly (React Native throws), so the list's `key` must change with it. Only a real
 * multi-column list needs the column count in its key - list/image modes (1 column) keep the plain mode key, so a rotation never
 * remounts them.
 */
export function gridListKey(mode: string, isGrid: boolean, columns: number): string {
  return isGrid ? `${mode}:${columns}` : mode;
}
