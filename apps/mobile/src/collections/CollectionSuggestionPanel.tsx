import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { CategoryIconTile } from './CategoryIconTile';
import { SiteIcon } from '../icons/SiteIcon';
import { colors, minTouchTarget, radii, spacing, themedStyles } from '../theme/tokens';
import type { CollectionSuggestionRow } from './collectionSuggestions';

interface CollectionSuggestionPanelProps {
  readonly collections: readonly CollectionSuggestionRow[];
  readonly links: readonly CollectionSuggestionRow[];
  readonly collectionsHeading: string;
  readonly linksHeading: string;
  /** Distance from the top of the screen's list area: the panel floats under the search field, over the content below it. */
  readonly top: number;
  readonly isLoading: boolean;
  readonly onSelect: (row: CollectionSuggestionRow) => void;
}

/**
 * The quick suggestions under the Collections search field: a few Collections and links, drawn as one small elevated list that floats
 * over the tabs and cards (it never moves them). A plain absolute overlay of the screen - no Portal, no Modal. Compact rows, at least
 * 44dp tall; the second line of a link reads "Collection · host".
 */
export function CollectionSuggestionPanel({ collections, links, collectionsHeading, linksHeading, top, isLoading, onSelect }: CollectionSuggestionPanelProps) {
  return (
    <View accessibilityViewIsModal={false} style={[styles.panel, { top }]} testID="collection-suggestions">
      {collections.length > 0 ? <Text style={styles.heading}>{collectionsHeading}</Text> : null}
      {collections.map(row =>
        row.kind === 'collection' ? (
          <Pressable
            accessibilityLabel={row.collection.name}
            accessibilityRole="button"
            key={row.key}
            onPress={() => onSelect(row)}
            style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
            testID="collection-suggestion-collection"
          >
            <CategoryIconTile
              collectionId={row.collection.id}
              color={row.collection.color}
              icon={row.collection.icon}
              imageUrl={row.collection.iconImageUrl}
              imageVersion={row.collection.iconImageVersion}
              size={36}
            />
            <View style={styles.text}>
              <Text numberOfLines={1} style={styles.title}>
                {row.collection.name}
              </Text>
            </View>
          </Pressable>
        ) : null,
      )}
      {links.length > 0 ? <Text style={styles.heading}>{linksHeading}</Text> : null}
      {links.map(row =>
        row.kind === 'link' ? (
          <Pressable
            accessibilityLabel={`${row.title}, ${row.detail}`}
            accessibilityRole="button"
            key={row.key}
            onPress={() => onSelect(row)}
            style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
            testID="collection-suggestion-link"
          >
            <View style={styles.siteIcon}>
              <SiteIcon siteId={row.siteId} size={22} />
            </View>
            <View style={styles.text}>
              <Text numberOfLines={1} style={styles.title}>
                {row.title}
              </Text>
              <Text numberOfLines={1} style={styles.detail}>
                {row.detail}
              </Text>
            </View>
          </Pressable>
        ) : null,
      )}
      {isLoading ? <ActivityIndicator color={colors.textSecondary} size="small" style={styles.loading} testID="collection-suggestions-loading" /> : null}
    </View>
  );
}

const styles = themedStyles(() => ({
  // zIndex orders it above the list on iOS; elevation does both the shadow and the stacking on Android. The overlay is a direct child
  // of the screen (not of the list's header), so Android also delivers touches to the part that extends past the header.
  panel: {
    backgroundColor: colors.surface,
    borderColor: colors.inputBorder,
    borderRadius: radii.md + 4,
    borderWidth: 1,
    elevation: 8,
    end: spacing.xl,
    padding: spacing.xs,
    position: 'absolute',
    shadowColor: '#000000',
    shadowOffset: { height: 4, width: 0 },
    shadowOpacity: 0.12,
    shadowRadius: 10,
    start: spacing.xl,
    zIndex: 20,
  },
  heading: { color: colors.textSecondary, fontSize: 12, fontWeight: '700', paddingHorizontal: spacing.sm, paddingTop: spacing.sm, paddingBottom: spacing.xs },
  row: { alignItems: 'center', borderRadius: radii.md, flexDirection: 'row', gap: spacing.md, minHeight: minTouchTarget, paddingHorizontal: spacing.sm, paddingVertical: spacing.xs },
  rowPressed: { backgroundColor: colors.surfaceMuted },
  siteIcon: { alignItems: 'center', height: 36, justifyContent: 'center', width: 36 },
  text: { flex: 1, minWidth: 0 },
  title: { color: colors.textPrimary, fontSize: 15, fontWeight: '600' },
  detail: { color: colors.textSecondary, fontSize: 12.5 },
  loading: { paddingVertical: spacing.xs },
}));
