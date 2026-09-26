import { ActivityIndicator, Image, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { SiteIcon } from '../icons/SiteIcon';
import type { ItemHistoryEntry } from '../items/api/itemsApi';
import { resolveEffectiveThumbnailUrl } from '../items/resolveEffectiveThumbnailUrl';
import { useTranslation } from 'react-i18next';
import { resolveSavedLinkDisplayTitle } from '../items/savedLinkPrimaryText';
import { resolveSiteInfo } from '../items/resolveSiteInfo';
import { colors, ltrTextStyle, radii, spacing } from '../theme/tokens';
import { SavedLinkMetaRow, type SavedLinkDateDisplayMode } from './SavedLinkMetaRow';
import { SwipeableItemRow } from './SwipeableItemRow';

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
}

/**
 * Presentation-only compact counterpart to SavedLinkRow; parent SwipeableItemRow keeps all actions intact.
 * Its secondary line is the exact same SavedLinkMetaRow List uses (saved time + platform icon).
 * Title and meta areas always reserve their full line height (scaled by the system font scale, since RN
 * scales lineHeight with it too), so a one-line title card is exactly as tall as a two-line one and a
 * 2-column grid never turns ragged/masonry-like.
 */
export function SavedLinkGridCard({ item, isActionInFlight, preferEffectiveThumbnail, dateDisplayMode = 'time' }: SavedLinkGridCardProps) {
  const { fontScale } = useWindowDimensions();
  const { t } = useTranslation();
  const displayTitle = resolveSavedLinkDisplayTitle(item.title, item.url, t);
  const imageUrl = preferEffectiveThumbnail ? resolveEffectiveThumbnailUrl(item) : item.representativeImage?.readUrl ?? null;
  const site = resolveSiteInfo(item.url);
  return <View style={styles.card}>
    <View style={styles.image}>
      {imageUrl ? <Image source={{ uri: imageUrl }} style={styles.thumbnail} /> : <View style={styles.fallback}><SiteIcon siteId={site.id} size={42} /></View>}
      {isActionInFlight ? <View style={styles.overlay}><ActivityIndicator color={colors.surface} size="small" /></View> : null}
    </View>
    <Text numberOfLines={SAVED_LINK_GRID_TITLE_MAX_LINES} style={[styles.title, { minHeight: TITLE_LINE_HEIGHT * SAVED_LINK_GRID_TITLE_MAX_LINES * fontScale }, displayTitle.isTechnicalIdentifier && ltrTextStyle]}>{displayTitle.text}</Text>
    <SavedLinkMetaRow dateDisplayMode={dateDisplayMode} savedAtUtc={item.savedAtUtc} style={[styles.meta, { minHeight: META_LINE_HEIGHT * fontScale }]} url={item.url} />
  </View>;
}

interface SavedLinkGridCellProps extends SavedLinkGridCardProps {
  readonly disabled?: boolean;
  readonly onPress: () => void;
  readonly onDelete: () => void;
  readonly onShare: () => void;
}

/**
 * The one Grid cell Home (DailyInboxScreen) and History (DateHistoryScreen) both render, so width,
 * spacing, card frame and swipe wrapper sizing can never drift between the two screens again. Spacing
 * lives on the outer cell, outside SwipeableItemRow's clipped wrapper - padding inside that wrapper is
 * exactly the area the swipe action panes would otherwise paint as a blue/red frame around the card.
 */
export function SavedLinkGridCell({ disabled, onPress, onDelete, onShare, ...cardProps }: SavedLinkGridCellProps) {
  return <View style={savedLinkGridLayout.cell}>
    <SwipeableItemRow containerStyle={savedLinkGridLayout.swipeContainer} disabled={disabled} onDelete={onDelete} onPress={onPress} onShare={onShare}>
      <SavedLinkGridCard {...cardProps} />
    </SwipeableItemRow>
  </View>;
}

export const savedLinkGridLayout = StyleSheet.create({
  cell: { flexBasis: '50%', marginBottom: spacing.sm, maxWidth: '50%', paddingHorizontal: 2 },
  swipeContainer: { backgroundColor: colors.surface, borderColor: colors.inputBorder, borderRadius: radii.lg, borderWidth: StyleSheet.hairlineWidth, flexGrow: 1 },
});

const styles = StyleSheet.create({
  card: { paddingHorizontal: spacing.xs, paddingVertical: spacing.sm },
  image: { aspectRatio: 1, borderRadius: radii.md + 4, overflow: 'hidden', position: 'relative' },
  thumbnail: { height: '100%', width: '100%' },
  fallback: { alignItems: 'center', backgroundColor: colors.surfaceMuted, flex: 1, justifyContent: 'center' },
  overlay: { alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.35)', bottom: 0, justifyContent: 'center', left: 0, position: 'absolute', right: 0, top: 0 },
  title: { color: colors.textPrimary, fontSize: 14, fontWeight: '600', lineHeight: TITLE_LINE_HEIGHT, marginTop: spacing.xs },
  meta: { marginTop: 2 },
});
