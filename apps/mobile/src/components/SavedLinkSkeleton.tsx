import { StyleSheet, useWindowDimensions, View } from 'react-native';
import { colors, radii, spacing } from '../theme/tokens';
import { GRID_CARD_PADDING_H } from './savedLinkLayout';

/**
 * Where a saved link is about to appear while its page loads - the same footprint as SavedLinkRow
 * (60dp thumbnail, a title line, a shorter second line, the meta line), in plain placeholder blocks,
 * so the row lands in place instead of the list jumping when it arrives. Static on purpose (no
 * shimmer): it costs nothing to render many of them, and there is no motion to reduce.
 * Hidden from accessibility - a list announces its loading state itself.
 */
export function SavedLinkRowSkeleton({ testID }: { readonly testID?: string }) {
  const { fontScale } = useWindowDimensions();
  return (
    <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={styles.row} testID={testID}>
      <View style={styles.thumbnail} />
      <View style={styles.textColumn}>
        <View style={[styles.line, styles.titleLine, { height: 14 * fontScale }]} />
        <View style={[styles.line, styles.secondLine, { height: 12 * fontScale }]} />
        <View style={[styles.line, styles.metaLine, { height: 10 * fontScale }]} />
      </View>
    </View>
  );
}

/** The grid (image view) counterpart - a square image block and two text lines, like SavedLinkGridCard. */
export function SavedLinkGridCardSkeleton({ testID }: { readonly testID?: string }) {
  const { fontScale } = useWindowDimensions();
  return (
    <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={styles.gridCard} testID={testID}>
      <View style={styles.gridImage} />
      <View style={[styles.line, styles.gridTitle, { height: 13 * fontScale }]} />
      <View style={[styles.line, styles.gridMeta, { height: 10 * fontScale }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    alignItems: 'center',
    flexDirection: 'row',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
  },
  thumbnail: {
    backgroundColor: colors.surfaceMuted,
    borderRadius: 14,
    height: 60,
    marginEnd: 12,
    width: 60,
  },
  textColumn: { flex: 1, gap: spacing.sm },
  line: { backgroundColor: colors.surfaceMuted, borderRadius: radii.sm },
  titleLine: { width: '85%' },
  secondLine: { width: '60%' },
  metaLine: { width: '35%' },
  gridCard: { paddingHorizontal: GRID_CARD_PADDING_H, paddingVertical: spacing.sm },
  gridImage: { aspectRatio: 1, backgroundColor: colors.surfaceMuted, borderRadius: radii.md + 4 },
  gridTitle: { marginTop: spacing.sm, width: '80%' },
  gridMeta: { marginTop: spacing.xs + 2, width: '45%' },
});
