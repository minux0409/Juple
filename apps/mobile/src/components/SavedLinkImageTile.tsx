import { memo } from 'react';
import { Image, View } from 'react-native';
import { Pressable } from './Pressable';
import { useTranslation } from 'react-i18next';
import { LinkIcon } from '../icons/LinkIcon';
import { LockIcon } from '../icons/LockIcon';
import { SiteIcon } from '../icons/SiteIcon';
import type { ItemHistoryEntry } from '../items/api/itemsApi';
import { resolveEffectiveThumbnail } from '../items/resolveEffectiveThumbnailUrl';
import { useStableImageUri } from '../images/stableImageUri';
import { resolveSavedLinkDisplayTitle } from '../items/savedLinkPrimaryText';
import { resolveSiteInfo } from '../items/resolveSiteInfo';
import { useTheme } from '../theme/ThemeContext';
import { colors, themedStyles } from '../theme/tokens';
import { useSavedLinkColumns } from '../layout/responsiveGrid';

/** Image view: tiles per line, and the small gap between tiles, both across and down. */
export const SAVED_LINK_IMAGE_COLUMNS = 3;
export const SAVED_LINK_IMAGE_GUTTER = 3;
/** Skeleton lines while a first page loads, and under the loaded lines while a next one does. */
export const SAVED_LINK_IMAGE_FIRST_PAGE_SKELETON_LINES = 3;
export const SAVED_LINK_IMAGE_NEXT_PAGE_SKELETON_LINES = 1;

/**
 * The links as lines of up to `columns` (the phone's SAVED_LINK_IMAGE_COLUMNS unless a wider window asks for more, see
 * layout/responsiveGrid) - the last line may be shorter (see SavedLinkImageRow).
 */
export function chunkIntoImageLines<T>(items: readonly T[], columns: number = SAVED_LINK_IMAGE_COLUMNS): readonly (readonly T[])[] {
  const lines: T[][] = [];
  for (let index = 0; index < items.length; index += columns) {
    lines.push(items.slice(index, index + columns));
  }
  return lines;
}

interface SavedLinkImageTileProps {
  readonly item: ItemHistoryEntry;
  readonly onPress: (item: ItemHistoryEntry) => void;
  /**
   * Long-press / the screen-reader "options" action: the same link menu every other view has (see useSavedLinkActions).
   * Pass a STABLE callback (the tile is memoized). A locked Collection's redacted tile never has one.
   */
  readonly onLongPress?: (item: ItemHistoryEntry) => void;
}

/**
 * Image view's one tile: a square that is only the picture - no title, time, host or memo, no card
 * frame. The picture is the same effective thumbnail every card uses (cover, then preview, then first
 * image - nothing is fetched here). Without a (loadable) picture: a known site's own icon, large, or a
 * plain link glyph, on a neutral square. A locked Collection's link (redacted by the server) is a lock on
 * a neutral square - never its thumbnail, site or text, in the accessibility label either.
 */
function SavedLinkImageTileView({ item, onPress, onLongPress }: SavedLinkImageTileProps) {
  const { t } = useTranslation();
  useTheme(); // memoized: it would not follow its parent's re-render, so it reads the theme itself
  // The URL that failed, not a flag: a refresh brings a fresh signed URL that deserves its own attempt.
  // Before any early return (hook order): the kept URI for this photo, else this response's fresh URL, else the fallback.
  const thumbnail = resolveEffectiveThumbnail(item);
  const { uri: imageUrl, onError } = useStableImageUri(thumbnail.cacheKey, thumbnail.url);

  if (item.isCollectionLocked) {
    return (
      <Pressable accessibilityLabel={t('item.lockedLinkPlaceholder')} accessibilityRole="button" onPress={() => onPress(item)} style={styles.tile} testID="saved-link-image-tile-locked">
        <View style={styles.fallback}><LockIcon color={colors.textSecondary} size={28} /></View>
      </Pressable>
    );
  }

  const showImage = imageUrl !== null;
  const siteId = resolveSiteInfo(item.url).id;
  return (
    <Pressable
      accessibilityActions={onLongPress ? [{ name: 'options', label: t('collections.linkActionsA11y') }] : undefined}
      accessibilityLabel={resolveSavedLinkDisplayTitle(item.title, item.url, t).text}
      accessibilityRole="button"
      delayLongPress={350}
      onAccessibilityAction={onLongPress ? event => { if (event.nativeEvent.actionName === 'options') { onLongPress(item); } } : undefined}
      onLongPress={onLongPress ? () => onLongPress(item) : undefined}
      onPress={() => onPress(item)}
      style={styles.tile}
      testID="saved-link-image-tile"
    >
      {showImage ? (
        <Image onError={onError} resizeMode="cover" source={{ uri: imageUrl }} style={styles.picture} testID="saved-link-image-tile-picture" />
      ) : (
        <View style={styles.fallback} testID="saved-link-image-tile-fallback">
          {siteId !== null ? <SiteIcon siteId={siteId} size={48} /> : <LinkIcon color={colors.textSecondary} size={30} />}
        </View>
      )}
    </Pressable>
  );
}

export const SavedLinkImageTile = memo(SavedLinkImageTileView);

interface SavedLinkImageRowProps {
  readonly items: readonly ItemHistoryEntry[];
  readonly onPress: (item: ItemHistoryEntry) => void;
  readonly onLongPress?: (item: ItemHistoryEntry) => void;
  readonly testID?: string;
}

/**
 * One line of the image grid: SAVED_LINK_IMAGE_COLUMNS equal squares, the gutter between them and
 * below the line. A short last line keeps the same square size (empty slots hold the width), and the
 * whole grid is just such lines inside the screen's ONE virtualized list.
 */
export function SavedLinkImageRow({ items, onPress, onLongPress, testID }: SavedLinkImageRowProps) {
  const { image: columns } = useSavedLinkColumns();
  return (
    <View style={styles.row} testID={testID}>
      {Array.from({ length: columns }, (_, index) => {
        const item = items[index];
        return item ? <SavedLinkImageTile item={item} key={item.id} onLongPress={onLongPress} onPress={onPress} /> : <View key={`empty-${index}`} style={styles.slot} />;
      })}
    </View>
  );
}

/** Where a line of tiles is about to appear - the same squares, nothing else. */
export function SavedLinkImageRowSkeleton({ testID }: { readonly testID?: string }) {
  const { image: columns } = useSavedLinkColumns();
  return (
    <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={styles.row} testID={testID}>
      {Array.from({ length: columns }, (_, index) => <View key={index} style={[styles.tile, styles.skeleton]} />)}
    </View>
  );
}

const styles = themedStyles(() => ({
  // width 100%: the tiles are flex:1 squares, so a line with no width of its own (e.g. a row-direction parent shrink-wrapping it) collapses to 0.
  row: { columnGap: SAVED_LINK_IMAGE_GUTTER, flexDirection: 'row', marginBottom: SAVED_LINK_IMAGE_GUTTER, width: '100%' },
  tile: { aspectRatio: 1, flex: 1, overflow: 'hidden' },
  slot: { aspectRatio: 1, flex: 1 },
  picture: { backgroundColor: colors.surfaceMuted, height: '100%', width: '100%' },
  fallback: { alignItems: 'center', backgroundColor: colors.surfaceMuted, flex: 1, justifyContent: 'center' },
  skeleton: { backgroundColor: colors.surfaceMuted },
}));
