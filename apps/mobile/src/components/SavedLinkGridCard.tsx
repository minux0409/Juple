import { useMemo, type ReactNode } from 'react';
import { ActivityIndicator, Image, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { SiteIcon } from '../icons/SiteIcon';
import type { ItemHistoryEntry } from '../items/api/itemsApi';
import { resolveEffectiveThumbnail } from '../items/resolveEffectiveThumbnailUrl';
import { imageCacheKey, useStableImageUri } from '../images/stableImageUri';
import { useTranslation } from 'react-i18next';
import { resolveSavedLinkDisplayTitle } from '../items/savedLinkPrimaryText';
import { resolveSiteInfo } from '../items/resolveSiteInfo';
import { colors, ltrTextStyle, radii, spacing, themedStyles } from '../theme/tokens';
import { columnBasis, useSavedLinkColumns } from '../layout/responsiveGrid';
import type { ItemAdderDisplay } from '../collections/itemAdder';
import { GRID_CARD_PADDING_H, GRID_CELL_PADDING_H } from './savedLinkLayout';
import { SavedLinkMetaRow, type SavedLinkDateDisplayMode } from './SavedLinkMetaRow';
import { SwipeableItemRow } from './SwipeableItemRow';
import { LockIcon } from '../icons/LockIcon';
import { OpenOriginalLinkButton } from './OpenOriginalLinkButton';

export const SAVED_LINK_GRID_TITLE_MAX_LINES = 2;
const TITLE_LINE_HEIGHT = 18;
/** One line of SavedLinkMetaRow (12pt time text / 15dp icon). */
const META_LINE_HEIGHT = 16;

interface SavedLinkGridCardProps {
  readonly item: ItemHistoryEntry;
  readonly isActionInFlight: boolean;
  readonly preferEffectiveThumbnail?: boolean;
  /** Same value the screen passes to its List-mode SavedLinkRow, so both modes show the same timestamp. */
  readonly dateDisplayMode?: SavedLinkDateDisplayMode;
  /**
   * Who added the link inside a shared Collection (see SavedLinkMetaRow). The caller passes it for
   * every tile of a list or for none (see shouldShowItemAdders), so tiles keep one height.
   */
  readonly addedBy?: ItemAdderDisplay | null;
  /** A shared link's reaction chips - see SavedLinkRow's `reactions`; omitted (nothing drawn) otherwise. */
  readonly reactions?: ReactNode;
  /** 바로가기: a small corner button on the card's meta line that opens the saved original page - see SavedLinkRow's `onOpenOriginal`. */
  readonly onOpenOriginal?: () => void;
  /** Draw the item's time on the meta line - off by default (see SavedLinkRow's `showTime`). */
  readonly showTime?: boolean;
}

/**
 * Presentation-only compact counterpart to SavedLinkRow; parent SwipeableItemRow keeps all actions intact.
 * Its secondary line is the exact same SavedLinkMetaRow List uses (saved time + platform icon).
 * Title and meta areas always reserve their full line height (scaled by the system font scale, since RN
 * scales lineHeight with it too), so a one-line title card is exactly as tall as a two-line one and a
 * 2-column grid never turns ragged/masonry-like.
 */
export function SavedLinkGridCard({ item, isActionInFlight, preferEffectiveThumbnail, dateDisplayMode = 'time', addedBy, reactions, onOpenOriginal, showTime = false }: SavedLinkGridCardProps) {
  const { fontScale } = useWindowDimensions();
  const { t } = useTranslation();
  // Before the locked early return (hook order): the kept URI for this photo, else this response's fresh URL, else the site icon.
  const thumbnail = preferEffectiveThumbnail
    ? resolveEffectiveThumbnail(item)
    : {
        url: item.representativeImage?.readUrl ?? null,
        cacheKey: item.representativeImage ? imageCacheKey(item.representativeImage.id, 'main') : null,
      };
  const { uri: imageUrl, onError: onImageError } = useStableImageUri(thumbnail.cacheKey, thumbnail.url);
  if (item.isCollectionLocked) {
    // A link of a locked Collection (redacted by the server): the SAME card - the square image area holds a lock, the
    // title area a fixed sentence (same reserved lines), the meta line only the saved time (no site icon).
    return <View style={styles.card} testID="saved-link-locked">
      <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={styles.image} testID="saved-link-locked-thumbnail">
        <View style={styles.fallback}><LockIcon color={colors.textSecondary} size={34} /></View>
      </View>
      <Text numberOfLines={SAVED_LINK_GRID_TITLE_MAX_LINES} style={[styles.title, { minHeight: TITLE_LINE_HEIGHT * SAVED_LINK_GRID_TITLE_MAX_LINES * fontScale }]}>{t('item.lockedLinkPlaceholder')}</Text>
      <SavedLinkMetaRow dateDisplayMode={dateDisplayMode} savedAtUtc={item.savedAtUtc} showSiteIcon={false} showTime={showTime} style={[styles.meta, { minHeight: META_LINE_HEIGHT * fontScale }]} url="" />
      {/* Nothing to say on the meta line (no time, no site): its reserved height still keeps the card as tall as its neighbours. */}
      {showTime ? null : <View style={[styles.meta, { minHeight: META_LINE_HEIGHT * fontScale }]} />}
    </View>;
  }
  const displayTitle = resolveSavedLinkDisplayTitle(item.title, item.url, t);
  const site = resolveSiteInfo(item.url);
  return <View style={styles.card}>
    <View style={styles.image}>
      {imageUrl ? <Image onError={onImageError} source={{ uri: imageUrl }} style={styles.thumbnail} /> : <View style={styles.fallback}><SiteIcon siteId={site.id} size={42} /></View>}
      {isActionInFlight ? <View style={styles.overlay}><ActivityIndicator color={colors.onOverlay} size="small" /></View> : null}
    </View>
    <Text numberOfLines={SAVED_LINK_GRID_TITLE_MAX_LINES} style={[styles.title, { minHeight: TITLE_LINE_HEIGHT * SAVED_LINK_GRID_TITLE_MAX_LINES * fontScale }, displayTitle.isTechnicalIdentifier && ltrTextStyle]}>{displayTitle.text}</Text>
    {/* The meta line (site icon / adder) and, at its end, the 바로가기 button - its own cell, so it never overlaps the picture or the title. */}
    <View style={styles.metaLine}>
      <SavedLinkMetaRow adderTrailing={reactions} addedBy={addedBy} dateDisplayMode={dateDisplayMode} savedAtUtc={item.savedAtUtc} showTime={showTime} style={[styles.meta, styles.metaFill, { minHeight: META_LINE_HEIGHT * fontScale }]} trailingAction={onOpenOriginal ? <OpenOriginalLinkButton onPress={onOpenOriginal} variant="card" /> : undefined} url={item.url} />
    </View>
    {addedBy ? null : reactions}
  </View>;
}

interface SavedLinkGridCellProps extends SavedLinkGridCardProps {
  /** The cell's column in a row drawn on the screen's content edge (see edgeAlignedCellPadding); absent inside a date card. */
  readonly column?: number;
  readonly disabled?: boolean;
  readonly onPress: () => void;
  readonly onDelete: () => void;
  readonly onShare?: () => void;
  /** Long-press / the screen-reader "options" action - see SwipeableItemRow. Absent: no menu. */
  readonly onLongPress?: () => void;
}

/**
 * The one Grid cell Home (DailyInboxScreen) and History (DateHistoryScreen) both render, so width,
 * spacing, card frame and swipe wrapper sizing can never drift between the two screens again. Spacing
 * lives on the outer cell, outside SwipeableItemRow's clipped wrapper - padding inside that wrapper is
 * exactly the area the swipe action panes would otherwise paint as a blue/red frame around the card.
 */
export function SavedLinkGridCell({ column, disabled, onPress, onDelete, onShare, onLongPress, ...cardProps }: SavedLinkGridCellProps) {
  const cellStyle = useSavedLinkGridCellStyle();
  const { grid } = useSavedLinkColumns();
  return <View style={column === undefined ? cellStyle : [cellStyle, edgeAlignedCellPadding(column, grid)]}>
    <SwipeableItemRow containerStyle={savedLinkGridLayout.swipeContainer} disabled={disabled} onOpenOriginal={cardProps.onOpenOriginal} onDelete={onDelete} onLongPress={onLongPress} onPress={onPress} onShare={onShare}>
      <SavedLinkGridCard {...cardProps} />
    </SwipeableItemRow>
  </View>;
}

/**
 * A Grid cell's frame at the current window width: savedLinkGridLayout.cell with its share of the row set from the responsive column
 * count (2 on a phone = 50%, exactly the old fixed value). Every screen that draws its own cell uses this instead of `.cell`.
 */
export function useSavedLinkGridCellStyle() {
  const { grid } = useSavedLinkColumns();
  return useMemo(() => [savedLinkGridLayout.cell, { flexBasis: columnBasis(grid), maxWidth: columnBasis(grid) }], [grid]);
}

/**
 * A Grid row on a screen's own content edge (Home, 휴지통, a flat Collection or Archive list): the first card starts exactly where the
 * sort chips above start and the last one ends where the List / Grid switch ends, with the usual gap between cards. Column `column` of
 * `columns` gets gap * column / columns before it and gap * (columns - 1 - column) / columns after it - the same total for every cell,
 * so all cards stay the same width. (Cells inside a date card keep their even padding and the card's own inset.)
 */
export function edgeAlignedCellPadding(column: number, columns: number): { readonly paddingStart: number; readonly paddingEnd: number } {
  const gap = GRID_CELL_PADDING_H * 2;
  return { paddingStart: (gap * column) / columns, paddingEnd: (gap * (columns - 1 - column)) / columns };
}

export const savedLinkGridLayout = themedStyles(() => ({
  cell: { flexBasis: '50%', marginBottom: spacing.sm, maxWidth: '50%', paddingHorizontal: GRID_CELL_PADDING_H },
  swipeContainer: { backgroundColor: colors.surface, borderColor: colors.inputBorder, borderRadius: radii.lg, borderWidth: StyleSheet.hairlineWidth, flexGrow: 1 },
}));

const styles = themedStyles(() => ({
  card: { paddingHorizontal: GRID_CARD_PADDING_H, paddingVertical: spacing.sm },
  image: { aspectRatio: 1, borderRadius: radii.md + 4, overflow: 'hidden', position: 'relative' },
  thumbnail: { height: '100%', width: '100%' },
  fallback: { alignItems: 'center', backgroundColor: colors.surfaceMuted, flex: 1, justifyContent: 'center' },
  overlay: { alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.35)', bottom: 0, justifyContent: 'center', left: 0, position: 'absolute', right: 0, top: 0 },
  title: { color: colors.textPrimary, fontSize: 14, fontWeight: '600', lineHeight: TITLE_LINE_HEIGHT, marginTop: spacing.xs },
  meta: { marginTop: 2 },
  metaLine: { alignItems: 'center', flexDirection: 'row' },
  metaFill: { flex: 1, minWidth: 0 },
}));
