import { StyleSheet } from 'react-native';
import { colors, radii, spacing } from '../theme/tokens';

/**
 * The saved-link body's shared geometry - one set of values for Home, History, a Collection (any
 * sort, List or Grid), so the same link looks like the same design everywhere:
 *
 * - inside a row/tile: SavedLinkRow / SavedLinkGridCard own the padding (spacing.md / spacing.xs +
 *   spacing.sm), thumbnail, title (15/20 semibold, 2 lines) and meta typography;
 * - standalone cards (Home, a Collection in 이름순): `card` below - the swipe wrapper's frame and the
 *   gap to the next card (always below, so the first card never gets an extra top gap);
 * - cards inside a date accordion (History, a Collection in 시간순): dateAccordionStyles.row/rowLast;
 * - Grid tiles (every screen): savedLinkGridLayout (SavedLinkGridCard.tsx).
 *
 * Screen-specific content (adder avatar, reaction chips, selection mark, swipe actions) is added by
 * the screen but never changes these values.
 */
export const SAVED_LINK_CARD_GAP = spacing.sm + 2;
/**
 * Grid spacing, one rule for Home, 보관함 and a Collection: the sides get as much air as the top and
 * bottom - a tile's content sits spacing.sm in from its frame on every side, and neighbouring tiles
 * are spacing.sm apart (each cell contributes half) like the rows are vertically.
 */
export const GRID_CELL_PADDING_H = spacing.xs;
export const GRID_CARD_PADDING_H = spacing.sm;
/** Space between a screen's count/title block and its [sort ... List/Grid] controls row (Home and a Collection). */
export const LINK_CONTROLS_TOP_GAP = spacing.lg;
/** Space between that controls row and the first link / section below it - one value for Home and a Collection. */
export const LINK_CONTROLS_BOTTOM_GAP = spacing.md;
/** The small horizontal gap between a header title and its inline count ("최근 저장  3개"). */
export const TITLE_COUNT_GAP = spacing.sm;

export const savedLinkLayout = StyleSheet.create({
  // Passed as SwipeableItemRow's containerStyle (its wrapper needs overflow:'hidden' to clip the
  // revealed swipe actions to the card's rounded shape, so no shadow here - border + surface carry the look).
  card: {
    backgroundColor: colors.surface,
    borderColor: colors.inputBorder,
    borderRadius: radii.lg,
    borderWidth: StyleSheet.hairlineWidth,
    marginBottom: SAVED_LINK_CARD_GAP,
  },
});
