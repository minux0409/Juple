import {
  columnBasis,
  COLLECTION_TILE_SURFACE,
  getDeviceClass,
  getResponsiveColumnCount,
  getSavedLinkColumns,
  gridListKey,
  GRID_SCREEN_SIDE_PADDING,
  PHONE_SAVED_LINK_COLUMNS,
  SAVED_LINK_GRID_SURFACE,
  SAVED_LINK_IMAGE_SURFACE,
} from '../responsiveGrid';

// Real Android window sizes in dp: [name, width, height].
const PHONES = [
  ['small phone portrait', 360, 640],
  ['phone portrait', 411, 891],
  ['phone landscape', 891, 411],
  ['large phone landscape', 932, 430],
  ['foldable cover screen', 360, 800],
  ['foldable cover landscape', 800, 360],
] as const;
const TABLETS = {
  tablet7Portrait: { width: 600, height: 960 },
  tablet7Landscape: { width: 960, height: 600 },
  tablet10Portrait: { width: 800, height: 1280 },
  tablet10Landscape: { width: 1280, height: 800 },
  foldableOpenPortrait: { width: 673, height: 841 },
  foldableOpenLandscape: { width: 841, height: 673 },
};

describe('device classification (shortest window side, not width)', () => {
  it('a phone is a phone in portrait AND landscape', () => {
    for (const [name, width, height] of PHONES) {
      expect(getDeviceClass({ width, height })).toBe('phone');
      expect(getSavedLinkColumns({ width, height })).toEqual({ grid: 2, image: 3 });
      expect(getResponsiveColumnCount({ width, height }, COLLECTION_TILE_SURFACE)).toBe(4);
      expect(name).toBeTruthy();
    }
    expect(PHONE_SAVED_LINK_COLUMNS).toEqual({ grid: 2, image: 3 });
  });

  it('every tablet-sized window is a tablet in both orientations', () => {
    for (const window of Object.values(TABLETS)) {
      expect(getDeviceClass(window)).toBe('tablet');
    }
  });

  it('switches exactly at a 600dp shortest side', () => {
    expect(getDeviceClass({ width: 1200, height: 599 })).toBe('phone');
    expect(getDeviceClass({ width: 1200, height: 600 })).toBe('tablet');
    expect(getDeviceClass({ width: 599, height: 1200 })).toBe('phone');
  });

  it('a tablet in a narrow split-screen window is a phone-sized window and gets the phone layout', () => {
    expect(getSavedLinkColumns({ width: 400, height: 1280 })).toEqual({ grid: 2, image: 3 });
  });
});

describe('tablet columns grow with the available width, within bounds', () => {
  const expected = {
    tablet7Portrait: { grid: 3, image: 5, tiles: 5 },
    tablet7Landscape: { grid: 5, image: 8, tiles: 8 },
    tablet10Portrait: { grid: 4, image: 6, tiles: 6 },
    tablet10Landscape: { grid: 6, image: 8, tiles: 8 },
    foldableOpenPortrait: { grid: 3, image: 5, tiles: 5 },
    foldableOpenLandscape: { grid: 4, image: 7, tiles: 7 },
  } as const;

  it.each(Object.entries(expected))('%s', (name, want) => {
    const window = TABLETS[name as keyof typeof TABLETS];
    const link = getSavedLinkColumns(window);
    expect(link.grid).toBe(want.grid);
    expect(link.image).toBe(want.image);
    expect(getResponsiveColumnCount(window, COLLECTION_TILE_SURFACE)).toBe(want.tiles);
  });

  it('small tablets show 3 / 5 / 5 at least and large ones 4 / 6 / 6 at least', () => {
    for (const window of [TABLETS.tablet7Portrait, TABLETS.foldableOpenPortrait]) {
      expect(getSavedLinkColumns(window).grid).toBeGreaterThanOrEqual(3);
      expect(getSavedLinkColumns(window).image).toBeGreaterThanOrEqual(5);
    }
    for (const window of [TABLETS.tablet10Portrait, TABLETS.tablet10Landscape, TABLETS.tablet7Landscape]) {
      expect(getSavedLinkColumns(window).grid).toBeGreaterThanOrEqual(4);
      expect(getSavedLinkColumns(window).image).toBeGreaterThanOrEqual(6);
    }
  });

  it('cells stay close to a phone\'s size: never wider than ~215dp (link cards), ~160dp (tiles), never under the minimum', () => {
    for (const window of Object.values(TABLETS)) {
      const width = window.width - GRID_SCREEN_SIDE_PADDING;
      const link = getSavedLinkColumns(window);
      expect(width / link.grid).toBeGreaterThanOrEqual(SAVED_LINK_GRID_SURFACE.minCellWidth);
      expect(width / link.grid).toBeLessThanOrEqual(215);
      expect(width / link.image).toBeGreaterThanOrEqual(SAVED_LINK_IMAGE_SURFACE.minCellWidth);
      expect(width / link.image).toBeLessThanOrEqual(160);
    }
  });

  it('a bottom sheet capped at 640dp sizes its tiles to the sheet, not the window', () => {
    for (const window of Object.values(TABLETS)) {
      const columns = getResponsiveColumnCount(window, COLLECTION_TILE_SURFACE, 640);
      expect(columns).toBe(5);
      expect((640 - GRID_SCREEN_SIDE_PADDING) / columns).toBeGreaterThanOrEqual(COLLECTION_TILE_SURFACE.minCellWidth);
    }
  });

  it('never exceeds the per-surface cap on a very wide window', () => {
    const huge = { width: 2000, height: 1200 };
    expect(getSavedLinkColumns(huge)).toEqual({ grid: 6, image: 8 });
    expect(getResponsiveColumnCount(huge, COLLECTION_TILE_SURFACE)).toBe(8);
  });
});

describe('helpers', () => {
  it('formats the cell basis as an exact share of the row', () => {
    expect(columnBasis(2)).toBe('50%');
    expect(columnBasis(4)).toBe('25%');
    expect(columnBasis(5)).toBe('20%');
  });

  it('only a multi-column grid carries the column count in its list key', () => {
    expect(gridListKey('grid', true, 3)).toBe('grid:3');
    expect(gridListKey('grid', true, 2)).not.toBe(gridListKey('grid', true, 3));
    expect(gridListKey('list', false, 3)).toBe('list');
    expect(gridListKey('image', false, 6)).toBe('image');
  });
});
