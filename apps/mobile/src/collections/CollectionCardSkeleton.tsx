import { StyleSheet, useWindowDimensions, View } from 'react-native';
import { colors, radii, spacing } from '../theme/tokens';

interface CollectionCardSkeletonProps {
  readonly variant: 'grid' | 'list';
  /** The grid cell's width share (e.g. '25%'), so a skeleton line matches the real grid exactly. */
  readonly gridBasis?: `${number}%`;
  readonly testID?: string;
}

/**
 * Where a Collection card is about to appear while its page loads - the same footprint as the
 * Collections grid tile (56dp icon + name) or list row (48dp icon + name), in plain placeholder
 * blocks. Static (no shimmer), cheap to render many of, and hidden from accessibility.
 */
export function CollectionCardSkeleton({ variant, gridBasis = '25%', testID }: CollectionCardSkeletonProps) {
  const { fontScale } = useWindowDimensions();
  return variant === 'grid' ? (
    <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={[styles.gridCell, { flexBasis: gridBasis }]} testID={testID}>
      <View style={styles.gridIcon} />
      <View style={[styles.line, styles.gridLabel, { height: 12 * fontScale }]} />
    </View>
  ) : (
    <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={styles.listRow} testID={testID}>
      <View style={styles.listIcon} />
      <View style={[styles.line, styles.listName, { height: 14 * fontScale }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  gridCell: { alignItems: 'center', paddingVertical: spacing.md },
  gridIcon: { backgroundColor: colors.surfaceMuted, borderRadius: radii.md + 4, height: 56, width: 56 },
  gridLabel: { marginTop: spacing.xs + 2, width: 56 },
  line: { backgroundColor: colors.surfaceMuted, borderRadius: radii.sm },
  listRow: { alignItems: 'center', backgroundColor: colors.surface, borderRadius: radii.md, flexDirection: 'row', gap: spacing.md, marginBottom: spacing.sm, padding: spacing.sm },
  listIcon: { backgroundColor: colors.surfaceMuted, borderRadius: radii.md, height: 48, width: 48 },
  listName: { width: '50%' },
});
