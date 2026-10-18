import { placeCard, sameRect, spotlightFor, TOUR_EDGE, TOUR_GAP, TOUR_SPOTLIGHT_PADDING } from '../tourPlacement';

const SCREEN = { width: 400, height: 800 };
const CARD = { width: 320, height: 180 };

describe('tour card placement', () => {
  it('centres the card when there is nothing to point at', () => {
    const placement = placeCard(null, SCREEN, CARD);
    expect(placement.side).toBe('center');
    expect(placement.left).toBe(40);
    expect(placement.top).toBe(310);
  });

  it('puts the card below a target near the top, and above one near the bottom, never over it', () => {
    const top = spotlightFor({ x: 20, y: 100, width: 360, height: 56 }, SCREEN);
    const below = placeCard(top, SCREEN, CARD);
    expect(below.side).toBe('below');
    expect(below.top).toBe(top.y + top.height + TOUR_GAP);

    const bottom = spotlightFor({ x: 20, y: 720, width: 80, height: 56 }, SCREEN);
    const above = placeCard(bottom, SCREEN, CARD);
    expect(above.side).toBe('above');
    expect(above.top + CARD.height + TOUR_GAP).toBeLessThanOrEqual(bottom.y);
  });

  it('keeps the card inside the screen edges horizontally, whatever the target', () => {
    const farLeft = placeCard(spotlightFor({ x: 0, y: 100, width: 40, height: 40 }, SCREEN), SCREEN, CARD);
    const farRight = placeCard(spotlightFor({ x: 360, y: 100, width: 40, height: 40 }, SCREEN), SCREEN, CARD);
    expect(farLeft.left).toBeGreaterThanOrEqual(TOUR_EDGE);
    expect(farRight.left + CARD.width).toBeLessThanOrEqual(SCREEN.width - TOUR_EDGE);
  });

  it('falls back to the centre when a tall target leaves no room above or below', () => {
    const tall = spotlightFor({ x: 10, y: 60, width: 380, height: 700 }, SCREEN);
    expect(placeCard(tall, SCREEN, CARD).side).toBe('center');
  });

  it('keeps a large card (large fonts) inside a short landscape screen', () => {
    const placement = placeCard(null, { width: 800, height: 360 }, { width: 360, height: 400 });
    expect(placement.top).toBeGreaterThanOrEqual(TOUR_EDGE);
  });

  it('grows the target by the spotlight padding but never outside the container', () => {
    expect(spotlightFor({ x: 100, y: 100, width: 50, height: 50 }, SCREEN)).toEqual({
      x: 100 - TOUR_SPOTLIGHT_PADDING,
      y: 100 - TOUR_SPOTLIGHT_PADDING,
      width: 50 + 2 * TOUR_SPOTLIGHT_PADDING,
      height: 50 + 2 * TOUR_SPOTLIGHT_PADDING,
    });
    const edge = spotlightFor({ x: 0, y: 0, width: 400, height: 800 }, SCREEN);
    expect(edge).toEqual({ x: 0, y: 0, width: 400, height: 800 });
  });

  it('treats sub-pixel movement as the same rectangle', () => {
    expect(sameRect({ x: 1, y: 1, width: 10, height: 10 }, { x: 1.4, y: 1, width: 10, height: 10.2 })).toBe(true);
    expect(sameRect({ x: 1, y: 1, width: 10, height: 10 }, { x: 5, y: 1, width: 10, height: 10 })).toBe(false);
    expect(sameRect(null, null)).toBe(true);
    expect(sameRect(null, { x: 0, y: 0, width: 1, height: 1 })).toBe(false);
  });
});

describe('spotlightRadius', () => {
  const { spotlightRadius, DEFAULT_TOUR_TARGET_RADIUS } = jest.requireActual<typeof import('../tourPlacement')>('../tourPlacement');

  it('is the target radius grown by the padding the ring reaches beyond it (R + P)', () => {
    expect(spotlightRadius(20, { width: 380, height: 68 })).toBe(20 + TOUR_SPOTLIGHT_PADDING);
    expect(spotlightRadius(0, { width: 300, height: 60 })).toBe(TOUR_SPOTLIGHT_PADDING);
  });

  it('a target that declares nothing uses the default control radius', () => {
    expect(spotlightRadius(undefined, { width: 100, height: 100 })).toBe(DEFAULT_TOUR_TARGET_RADIUS + TOUR_SPOTLIGHT_PADDING);
    expect(spotlightRadius(Number.NaN, { width: 100, height: 100 })).toBe(DEFAULT_TOUR_TARGET_RADIUS + TOUR_SPOTLIGHT_PADDING);
    expect(spotlightRadius(-4, { width: 100, height: 100 })).toBe(DEFAULT_TOUR_TARGET_RADIUS + TOUR_SPOTLIGHT_PADDING);
  });

  it('never exceeds a pill of the ring\'s own size', () => {
    expect(spotlightRadius(40, { width: 200, height: 30 })).toBe(15);
  });
});

describe('cornerWedges - the dimmed area follows the rounded spotlight', () => {
  const { cornerWedges } = jest.requireActual<typeof import('../tourPlacement')>('../tourPlacement');
  type Rect = { x: number; y: number; width: number; height: number };
  const inside = (rect: Rect, px: number, py: number) => px >= rect.x && px < rect.x + rect.width && py >= rect.y && py < rect.y + rect.height;

  /** The scrim exactly as TourHost draws it: four rectangles around the spotlight rectangle, plus the corner wedges. */
  function isDimmed(spot: Rect, radius: number, container: { width: number; height: number }, px: number, py: number): boolean {
    const rects: Rect[] = [
      { x: 0, y: 0, width: container.width, height: spot.y },
      { x: 0, y: spot.y + spot.height, width: container.width, height: container.height - spot.y - spot.height },
      { x: 0, y: spot.y, width: spot.x, height: spot.height },
      { x: spot.x + spot.width, y: spot.y, width: container.width - spot.x - spot.width, height: spot.height },
    ];
    if (rects.some(rect => inside(rect, px, py))) {
      return true;
    }
    return cornerWedges(spot, radius).some(wedge => {
      if (!inside(wedge.box, px, py)) {
        return false;
      }
      // The clipped ring: dimmed where the distance to the ring's centre lies between its inner (r) and outer (2r) radius.
      const cx = wedge.box.x + wedge.ring.left + wedge.ring.size / 2;
      const cy = wedge.box.y + wedge.ring.top + wedge.ring.size / 2;
      const distance = Math.hypot(px - cx, py - cy);
      return distance >= wedge.ring.size / 4 && distance <= wedge.ring.size / 2;
    });
  }

  /** The shape the spotlight should have: a rounded rectangle. */
  function isOutsideRoundedRect(spot: Rect, radius: number, px: number, py: number): boolean {
    if (!inside(spot, px, py)) {
      return true;
    }
    const r = Math.min(radius, spot.width / 2, spot.height / 2);
    const nx = Math.min(Math.max(px, spot.x + r), spot.x + spot.width - r);
    const ny = Math.min(Math.max(py, spot.y + r), spot.y + spot.height - r);
    return Math.hypot(px - nx, py - ny) > r;
  }

  it.each([
    ['a large rounded input', { x: 10, y: 114, width: 380, height: 68 }, 26],
    ['a button radius (8 + 6)', { x: 20, y: 300, width: 120, height: 56 }, 14],
    ['a pill (clamped to half the height)', { x: 40, y: 500, width: 200, height: 44 }, 60],
  ])('%s: no bright corner gap outside the curve and nothing inside it dimmed', (_name, spot, radius) => {
    const container = { width: 400, height: 800 };
    let wrong = 0;
    for (let px = Math.max(0, spot.x - 12); px < Math.min(container.width, spot.x + spot.width + 12); px += 0.5) {
      for (let py = Math.max(0, spot.y - 12); py < Math.min(container.height, spot.y + spot.height + 12); py += 0.5) {
        const dimmed = isDimmed(spot, radius, container, px, py);
        const expected = isOutsideRoundedRect(spot, radius, px, py);
        // Allow only the 1px anti-aliasing seam on the curve itself.
        if (dimmed !== expected) {
          const r = Math.min(radius, spot.width / 2, spot.height / 2);
          const nx = Math.min(Math.max(px, spot.x + r), spot.x + spot.width - r);
          const ny = Math.min(Math.max(py, spot.y + r), spot.y + spot.height - r);
          if (Math.abs(Math.hypot(px - nx, py - ny) - r) > 0.75) {
            wrong += 1;
          }
        }
      }
    }
    expect(wrong).toBe(0);
  });

  it('a square spotlight (radius 0) needs no wedges at all, and the radius is clamped to a pill', () => {
    expect(cornerWedges({ x: 0, y: 0, width: 100, height: 50 }, 0)).toEqual([]);
    const wedges = cornerWedges({ x: 0, y: 0, width: 100, height: 40 }, 500);
    expect(wedges).toHaveLength(4);
    expect(wedges[0].box.width).toBe(20);
    expect(wedges[0].ring.size).toBe(80);
  });
});
