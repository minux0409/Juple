import {
  clampCenterX,
  computeSlotCount,
  computeSlotPitch,
  hasCrossedOtherCenter,
  MAX_VIRTUAL_SLOTS,
  MIN_VIRTUAL_SLOTS,
  resolveDrop,
  slotCenterX,
  THUMBNAIL_GAP,
  THUMBNAIL_SIZE,
} from '../twoSlotDrag';

const MIN_SLOT_PITCH = THUMBNAIL_SIZE + THUMBNAIL_GAP;

describe('computeSlotCount', () => {
  it('never goes below MIN_VIRTUAL_SLOTS, even for a narrow or zero/negative track', () => {
    expect(computeSlotCount(0)).toBe(MIN_VIRTUAL_SLOTS);
    expect(computeSlotCount(-10)).toBe(MIN_VIRTUAL_SLOTS);
    expect(computeSlotCount(MIN_SLOT_PITCH)).toBe(MIN_VIRTUAL_SLOTS);
  });

  it('never goes above MAX_VIRTUAL_SLOTS, even for a very wide track', () => {
    expect(computeSlotCount(MIN_SLOT_PITCH * 50)).toBe(MAX_VIRTUAL_SLOTS);
  });

  it('fits as many real slot-pitch-wide slots as the measured width actually allows', () => {
    expect(computeSlotCount(MIN_SLOT_PITCH * 3)).toBe(3);
    expect(computeSlotCount(MIN_SLOT_PITCH * 4)).toBe(4);
    // Not quite enough room for a 5th slot - still only 4, not rounded up.
    expect(computeSlotCount(MIN_SLOT_PITCH * 4 + 1)).toBe(4);
  });
});

describe('computeSlotPitch', () => {
  it('is at least MIN_SLOT_PITCH whenever the track is wide enough for that many slots to fit', () => {
    expect(computeSlotPitch(MIN_SLOT_PITCH * 3.5)).toBeGreaterThanOrEqual(MIN_SLOT_PITCH);
    expect(computeSlotPitch(1000)).toBeGreaterThanOrEqual(MIN_SLOT_PITCH);
  });

  it('MIN_VIRTUAL_SLOTS (need at least 2 resting positions for 2 photos) still wins even on a track too narrow for a full MIN_SLOT_PITCH each - the two photos simply sit closer together than ideal rather than collapsing to one slot', () => {
    expect(computeSlotPitch(MIN_SLOT_PITCH)).toBe(MIN_SLOT_PITCH / 2);
  });

  it('evenly divides the measured track width by however many slots fit', () => {
    const trackWidth = MIN_SLOT_PITCH * 4;
    expect(computeSlotPitch(trackWidth)).toBeCloseTo(trackWidth / 4);
  });
});

describe('slotCenterX', () => {
  it('is the middle of each slot, left to right', () => {
    const pitch = 100;
    expect(slotCenterX(0, pitch)).toBe(50);
    expect(slotCenterX(1, pitch)).toBe(150);
    expect(slotCenterX(2, pitch)).toBe(250);
  });
});

describe('clampCenterX', () => {
  const trackWidth = 400;
  const half = THUMBNAIL_SIZE / 2;

  it('clamps to the track left edge (half a thumbnail in) - never past it', () => {
    expect(clampCenterX(-1000, trackWidth)).toBe(half);
    expect(clampCenterX(half, trackWidth)).toBe(half);
  });

  it('clamps to the track right edge (half a thumbnail in) - never past it', () => {
    expect(clampCenterX(1000, trackWidth)).toBe(trackWidth - half);
    expect(clampCenterX(trackWidth - half, trackWidth)).toBe(trackWidth - half);
  });

  it('passes through unchanged when already inside the track', () => {
    expect(clampCenterX(200, trackWidth)).toBe(200);
  });

  it('never produces NaN/undefined for a degenerate (too-narrow) track', () => {
    expect(clampCenterX(50, 10)).toBe(5);
  });
});

describe('hasCrossedOtherCenter', () => {
  const pitch = 100; // slot 0 center = 50, slot 1 center = 150

  it('slot 0 dragged right: false until its center is strictly past slot 1\'s center', () => {
    expect(hasCrossedOtherCenter(0, 50, pitch)).toBe(false);
    expect(hasCrossedOtherCenter(0, 149, pitch)).toBe(false);
    expect(hasCrossedOtherCenter(0, 150, pitch)).toBe(false); // exactly at the other center: not crossed
    expect(hasCrossedOtherCenter(0, 151, pitch)).toBe(true);
  });

  it('slot 1 dragged left: false until its center is strictly past slot 0\'s center', () => {
    expect(hasCrossedOtherCenter(1, 150, pitch)).toBe(false);
    expect(hasCrossedOtherCenter(1, 51, pitch)).toBe(false);
    expect(hasCrossedOtherCenter(1, 50, pitch)).toBe(false); // exactly at the other center: not crossed
    expect(hasCrossedOtherCenter(1, 49, pitch)).toBe(true);
  });
});

describe('resolveDrop', () => {
  const pitch = 100; // slot 0 center = 50, slot 1 center = 150

  it('returns null (no swap) when the dragged photo never actually reached the other photo\'s center', () => {
    expect(resolveDrop(0, 50, pitch)).toBeNull();
    expect(resolveDrop(0, 120, pitch)).toBeNull();
    expect(resolveDrop(1, 150, pitch)).toBeNull();
    expect(resolveDrop(1, 80, pitch)).toBeNull();
  });

  it('slot 0 dragged past slot 1\'s center resolves to a 0 -> 1 swap', () => {
    expect(resolveDrop(0, 151, pitch)).toEqual({ from: 0, to: 1 });
  });

  it('slot 1 dragged past slot 0\'s center resolves to a 1 -> 0 swap', () => {
    expect(resolveDrop(1, 49, pitch)).toEqual({ from: 1, to: 0 });
  });
});
