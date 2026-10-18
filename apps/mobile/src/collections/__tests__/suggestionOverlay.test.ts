import { getSuggestionOverlayFrame, MIN_PANEL_HEIGHT } from '../suggestionOverlay';

const root = { x: 0, y: 24, width: 400, height: 776 };

describe('getSuggestionOverlayFrame', () => {
  it('hangs from the field\'s measured bottom edge: top = searchBottom + gap, left / width = the field\'s own', () => {
    const frame = getSuggestionOverlayFrame({ root, search: { x: 20, y: 140, width: 360, height: 48 }, gap: 4, bottomLimit: 800 });
    expect(frame.top).toBe(140 - 24 + 48 + 4);
    expect(frame.left).toBe(20);
    expect(frame.width).toBe(360);
    // The panel starts BELOW the field: never over it.
    expect(frame.top).toBeGreaterThan(140 - 24 + 48 - 1);
    expect(frame.anchorHidden).toBe(false);
  });

  it('the container\'s own window offset is the only correction (a container that is not at 0,0)', () => {
    const shifted = getSuggestionOverlayFrame({ root: { x: 10, y: 100, width: 380, height: 700 }, search: { x: 30, y: 220, width: 340, height: 48 }, gap: 4, bottomLimit: 800 });
    expect(shifted.left).toBe(20);
    expect(shifted.top).toBe(220 - 100 + 48 + 4);
  });

  it('moves one-to-one with the field: scrolling the field up by n moves the panel up by n (no extra scroll term)', () => {
    const at = (y: number) => getSuggestionOverlayFrame({ root, search: { x: 20, y, width: 360, height: 48 }, gap: 4, bottomLimit: 800 }).top;
    expect(at(140) - at(100)).toBe(40);
  });

  it('the room below is limited by the keyboard when it is higher than the container\'s bottom, and never below a usable minimum', () => {
    const search = { x: 20, y: 140, width: 360, height: 48 };
    const open = getSuggestionOverlayFrame({ root, search, gap: 4, bottomLimit: 800 });
    expect(open.maxHeight).toBe(800 - (24 + open.top));
    const withKeyboard = getSuggestionOverlayFrame({ root, search, gap: 4, bottomLimit: 500 });
    expect(withKeyboard.maxHeight).toBe(500 - (24 + withKeyboard.top));
    expect(withKeyboard.maxHeight).toBeLessThan(open.maxHeight);
    const cramped = getSuggestionOverlayFrame({ root, search, gap: 4, bottomLimit: 200 });
    expect(cramped.maxHeight).toBe(MIN_PANEL_HEIGHT);
  });

  it('a field scrolled out of the container (above or below) has nothing to hang from', () => {
    const hidden = (y: number) => getSuggestionOverlayFrame({ root, search: { x: 20, y, width: 360, height: 48 }, gap: 4, bottomLimit: 800 }).anchorHidden;
    expect(hidden(-100)).toBe(true);
    expect(hidden(24 - 48)).toBe(true);
    expect(hidden(900)).toBe(true);
    expect(hidden(24)).toBe(false);
    expect(hidden(500)).toBe(false);
  });
});
