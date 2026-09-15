/**
 * Pure geometry/decision helpers for PhotoListEditor's photo reorder track (see that file's own
 * remarks). The track's width is always the *actual measured* on-screen width (via onLayout) -
 * never a hardcoded guess - subdivided into a small number of fixed "virtual slots" that exist
 * purely to give drag movement a bounded, structured feel (like Android home-screen icon reorder),
 * not because the app ever shows more than MAX_EFFECTIVE_IMAGES (2) real photos at once.
 *
 * Kept separate from the PanResponder/Animated plumbing so the actual "did the dragged photo's
 * center cross the other photo's center" decision is testable with plain function calls,
 * independent of simulating real touch gestures or real on-screen layout.
 */

export const THUMBNAIL_SIZE = 88;
export const THUMBNAIL_GAP = 10;
/** A virtual slot must be at least this wide for a thumbnail to sit centered in it without
 * overlapping a neighboring slot's thumbnail. */
const MIN_SLOT_PITCH = THUMBNAIL_SIZE + THUMBNAIL_GAP;
export const MIN_VIRTUAL_SLOTS = 2;
export const MAX_VIRTUAL_SLOTS = 5;

export type SlotIndex = 0 | 1;

/** How many virtual slots the measured track actually has room for - between MIN_VIRTUAL_SLOTS and
 * MAX_VIRTUAL_SLOTS, derived from the real measured trackWidth, never a hardcoded pixel guess. */
export function computeSlotCount(trackWidth: number): number {
  if (!(trackWidth > 0)) {
    return MIN_VIRTUAL_SLOTS;
  }
  const fit = Math.floor(trackWidth / MIN_SLOT_PITCH);
  return Math.min(MAX_VIRTUAL_SLOTS, Math.max(MIN_VIRTUAL_SLOTS, fit));
}

/** Even width of each virtual slot for the measured track - at least MIN_SLOT_PITCH whenever the
 * track is wide enough for that many slots to fit. On a track narrower than
 * MIN_VIRTUAL_SLOTS * MIN_SLOT_PITCH, computeSlotCount's own MIN_VIRTUAL_SLOTS floor (there must
 * always be at least 2 resting positions for 2 photos) can still win, producing a pitch smaller
 * than MIN_SLOT_PITCH - the two photos then simply rest closer together than ideal, never fewer
 * than 2 slots. */
export function computeSlotPitch(trackWidth: number): number {
  return trackWidth / computeSlotCount(trackWidth);
}

/** The horizontal center (in the track's own local coordinate space) of virtual slot `slotIndex`. */
export function slotCenterX(slotIndex: number, slotPitch: number): number {
  return slotIndex * slotPitch + slotPitch / 2;
}

/** Clamps a dragged photo's live center X to stay fully inside the measured track - its edge can
 * never cross the track's own left/right bounds, computed from the real measured trackWidth
 * rather than any assumed constant. `overflow: hidden` on the track itself (see PhotoListEditor)
 * is a second, structural backstop on top of this - not a substitute for it. */
export function clampCenterX(centerX: number, trackWidth: number): number {
  const half = THUMBNAIL_SIZE / 2;
  if (trackWidth <= THUMBNAIL_SIZE) {
    return trackWidth / 2;
  }
  return Math.min(Math.max(centerX, half), trackWidth - half);
}

/** The sole reorder trigger: has the dragged photo's actual live center X crossed the *other*
 * photo's actual resting center X - never a raw gesture.dx/PITCH-fraction threshold. */
export function hasCrossedOtherCenter(draggedIndex: SlotIndex, liveCenterX: number, slotPitch: number): boolean {
  const otherIndex: SlotIndex = draggedIndex === 0 ? 1 : 0;
  const otherCenterX = slotCenterX(otherIndex, slotPitch);
  return draggedIndex === 0 ? liveCenterX > otherCenterX : liveCenterX < otherCenterX;
}

/** The [fromIndex, toIndex] pair to report via the existing onReorder(fromIndex, toIndex) contract
 * once a drag ends - null when the dragged photo's center never actually crossed the other
 * photo's center, i.e. nothing to persist and both simply snap back to their resting slots. */
export function resolveDrop(
  draggedIndex: SlotIndex,
  liveCenterX: number,
  slotPitch: number,
): { readonly from: number; readonly to: number } | null {
  if (!hasCrossedOtherCenter(draggedIndex, liveCenterX, slotPitch)) {
    return null;
  }
  return draggedIndex === 0 ? { from: 0, to: 1 } : { from: 1, to: 0 };
}
