export interface TourRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface TourSize {
  readonly width: number;
  readonly height: number;
}

export type TourSide = 'below' | 'above' | 'center';

export interface TourPlacement {
  readonly left: number;
  readonly top: number;
  readonly side: TourSide;
}

/** Room kept between the spotlight and the card, and between the card and the screen edge. */
export const TOUR_GAP = 12;
export const TOUR_EDGE = 16;
/** How far the spotlight reaches beyond the target itself. */
export const TOUR_SPOTLIGHT_PADDING = 6;

/** The target grown by the spotlight padding and kept inside the container. */
export function spotlightFor(target: TourRect, container: TourSize): TourRect {
  const x = Math.max(0, target.x - TOUR_SPOTLIGHT_PADDING);
  const y = Math.max(0, target.y - TOUR_SPOTLIGHT_PADDING);
  const right = Math.min(container.width, target.x + target.width + TOUR_SPOTLIGHT_PADDING);
  const bottom = Math.min(container.height, target.y + target.height + TOUR_SPOTLIGHT_PADDING);
  return { x, y, width: Math.max(0, right - x), height: Math.max(0, bottom - y) };
}

/**
 * Where the explanation card goes. Without a spotlight it is centred. Otherwise it sits below the spotlight, or above it when
 * below has no room, and never overlaps it; when neither side fits (a very tall target on a small screen) it is centred over the
 * container - the card is never cut off by the screen edge. Horizontally it is centred on the target and kept inside the edges.
 */
export function placeCard(spotlight: TourRect | null, container: TourSize, card: TourSize): TourPlacement {
  const maxLeft = Math.max(TOUR_EDGE, container.width - card.width - TOUR_EDGE);
  const clampLeft = (left: number) => Math.min(Math.max(TOUR_EDGE, left), maxLeft);
  const centered: TourPlacement = {
    left: clampLeft((container.width - card.width) / 2),
    top: Math.max(TOUR_EDGE, (container.height - card.height) / 2),
    side: 'center',
  };
  if (!spotlight) {
    return centered;
  }
  const left = clampLeft(spotlight.x + spotlight.width / 2 - card.width / 2);
  const below = spotlight.y + spotlight.height + TOUR_GAP;
  if (below + card.height <= container.height - TOUR_EDGE) {
    return { left, top: below, side: 'below' };
  }
  const above = spotlight.y - TOUR_GAP - card.height;
  if (above >= TOUR_EDGE) {
    return { left, top: above, side: 'above' };
  }
  return centered;
}

export function sameRect(a: TourRect | null, b: TourRect | null): boolean {
  if (a === null || b === null) {
    return a === b;
  }
  return Math.abs(a.x - b.x) < 1 && Math.abs(a.y - b.y) < 1 && Math.abs(a.width - b.width) < 1 && Math.abs(a.height - b.height) < 1;
}
