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
