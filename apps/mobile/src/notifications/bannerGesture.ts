import type { PanResponderGestureState } from 'react-native';

/** A banner is only ever swiped away sideways. */
export type BannerSwipeDirection = 'left' | 'right';

/** Finger travel below this is still a tap (the banner never takes over the touch). */
export const BANNER_TAP_SLOP = 8;
/** A horizontal drag past this distance dismisses on release. */
export const BANNER_SWIPE_DISMISS_DISTANCE = 40;
/** ...or a horizontal flick at least this fast (dp/ms). */
export const BANNER_SWIPE_DISMISS_VELOCITY = 0.5;

/**
 * Whether a move belongs to a horizontal swipe of the banner: beyond a tap's slop sideways AND more
 * sideways than vertical. A vertical (or vertical-dominant diagonal) movement is never the banner's -
 * it is not claimed, the banner stays where it is and nothing is dismissed.
 */
export function isHorizontalBannerDrag({ dx, dy }: Pick<PanResponderGestureState, 'dx' | 'dy'>): boolean {
  return Math.abs(dx) > BANNER_TAP_SLOP && Math.abs(dx) > Math.abs(dy);
}

/**
 * The direction a released (horizontal) drag dismisses the banner in - or null when it was too short
 * and slow, in which case the banner returns to its place. Only dx / vx count: once a horizontal drag
 * has been claimed, whatever the finger does vertically is ignored.
 */
export function resolveBannerSwipe({ dx, vx }: Pick<PanResponderGestureState, 'dx' | 'vx'>): BannerSwipeDirection | null {
  if (Math.abs(dx) > BANNER_SWIPE_DISMISS_DISTANCE || Math.abs(vx) > BANNER_SWIPE_DISMISS_VELOCITY) {
    return dx < 0 ? 'left' : 'right';
  }
  return null;
}
