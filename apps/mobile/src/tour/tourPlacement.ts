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

/** The corner radius assumed for a target that does not say its own (the common control radius). */
export const DEFAULT_TOUR_TARGET_RADIUS = 8;

/**
 * The corner radius of the spotlight ring: the target's own radius grown by the padding the ring reaches beyond it (an outer
 * rounded rectangle is R + P where the inner one is R), never more than a pill of the ring's own size.
 */
export function spotlightRadius(targetRadius: number | undefined, spotlight: TourSize, padding: number = TOUR_SPOTLIGHT_PADDING): number {
  const base = targetRadius !== undefined && Number.isFinite(targetRadius) && targetRadius >= 0 ? targetRadius : DEFAULT_TOUR_TARGET_RADIUS;
  return Math.min(base + padding, Math.min(spotlight.width, spotlight.height) / 2);
}

export type TourCorner = 'tl' | 'tr' | 'bl' | 'br';

export interface TourCornerWedge {
  readonly corner: TourCorner;
  /** The r x r square at that corner of the spotlight (overflow hidden): the part of it OUTSIDE the quarter circle is what is dimmed. */
  readonly box: TourRect;
  /** The 4r x 4r ring (inner radius r, outer 2r, border r) whose centre is the corner circle's centre - positioned inside `box`. */
  readonly ring: { readonly left: number; readonly top: number; readonly size: number };
}

/**
 * The four corner pieces that make the dimmed area follow a rounded spotlight. The scrim is four rectangles around a rectangular
 * hole; with a rounded ring the four corners of that hole would stay bright outside the curve. Each wedge is the r x r corner square
 * minus the quarter disc of radius r, drawn with plain Views as a clipped, very wide border (no mask, no extra dependency). The same
 * radius r as the ring is used, so the bright area and the ring are one shape. No wedges for a square spotlight.
 */
export function cornerWedges(spotlight: TourRect, radius: number): readonly TourCornerWedge[] {
  const r = Math.min(radius, spotlight.width / 2, spotlight.height / 2);
  if (!(r > 0)) {
    return [];
  }
  const { x, y, width, height } = spotlight;
  const size = 4 * r;
  return [
    { corner: 'tl', box: { x, y, width: r, height: r }, ring: { left: -r, top: -r, size } },
    { corner: 'tr', box: { x: x + width - r, y, width: r, height: r }, ring: { left: -2 * r, top: -r, size } },
    { corner: 'bl', box: { x, y: y + height - r, width: r, height: r }, ring: { left: -r, top: -2 * r, size } },
    { corner: 'br', box: { x: x + width - r, y: y + height - r, width: r, height: r }, ring: { left: -2 * r, top: -2 * r, size } },
  ];
}

/** The target grown by the spotlight padding and kept inside the container. */
/** `padding`: how far the ring stands off the target (the target's own, else TOUR_SPOTLIGHT_PADDING). */
export function spotlightFor(target: TourRect, container: TourSize, padding: number = TOUR_SPOTLIGHT_PADDING): TourRect {
  const x = Math.max(0, target.x - padding);
  const y = Math.max(0, target.y - padding);
  const right = Math.min(container.width, target.x + target.width + padding);
  const bottom = Math.min(container.height, target.y + target.height + padding);
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
