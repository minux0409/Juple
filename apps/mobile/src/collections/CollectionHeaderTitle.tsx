import { Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { LockIcon } from '../icons/LockIcon';
import { useTheme } from '../theme/ThemeContext';
import { colors, spacing, themedStyles } from '../theme/tokens';
import { CategoryIconTile } from './CategoryIconTile';

/** Smaller than the old in-page header tile: it sits inside the 44dp navigation bar row. */
export const COLLECTION_HEADER_ICON_SIZE = 28;

interface CollectionHeaderTitleProps {
  readonly collectionId: number;
  readonly name: string;
  readonly color?: string | null;
  readonly icon: string;
  readonly imageUrl?: string | null;
  readonly imageVersion?: string | null;
  readonly isLocked: boolean;
}

/**
 * The Collection's own icon and name as the stack header's title: "[icon] Name". One line always - a long name ends in "…"
 * at the end edge and never wraps; the icon (and lock) never shrink.
 */
export function CollectionHeaderTitle({ collectionId, name, color, icon, imageUrl, imageVersion, isLocked }: CollectionHeaderTitleProps) {
  const { t } = useTranslation();
  useTheme(); // rendered by the navigation header, which is not one of the screens' themed wrappers
  return (
    <View style={styles.row} testID="collection-details-header-title">
      <View style={styles.icon}>
        <CategoryIconTile collectionId={collectionId} color={color} icon={icon} imageUrl={imageUrl} imageVersion={imageVersion} size={COLLECTION_HEADER_ICON_SIZE} />
      </View>
      <Text accessibilityRole="header" ellipsizeMode="tail" numberOfLines={1} style={styles.title} testID="collection-details-title">{name}</Text>
      {isLocked ? (
        <View accessibilityLabel={t('collections.lockedA11y')} style={styles.icon} testID="collection-details-locked">
          <LockIcon color={colors.textSecondary} size={18} />
        </View>
      ) : null}
    </View>
  );
}

const styles = themedStyles(() => ({
  row: { alignItems: 'center', flexDirection: 'row', flexShrink: 1, gap: spacing.sm, minWidth: 0 },
  icon: { flexShrink: 0 },
  title: { color: colors.textPrimary, flexShrink: 1, fontSize: 17, fontWeight: '700', minWidth: 0 },
}));
