import { Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { LockIcon } from '../icons/LockIcon';
import { colors, spacing, themedStyles } from '../theme/tokens';
import { CategoryIconTile } from './CategoryIconTile';

const COLLECTION_HEADER_ICON_SIZE = 56;

interface CollectionHeaderTitleProps {
  readonly collectionId: number;
  readonly name: string;
  readonly color?: string | null;
  readonly icon: string;
  readonly imageUrl?: string | null;
  readonly imageVersion?: string | null;
  readonly isLocked: boolean;
}

export function CollectionHeaderTitle({ collectionId, name, color, icon, imageUrl, imageVersion, isLocked }: CollectionHeaderTitleProps) {
  const { t } = useTranslation();
  return (
    <View style={styles.row} testID="collection-details-header-title">
      <View style={styles.icon}>
        <CategoryIconTile collectionId={collectionId} color={color} icon={icon} imageUrl={imageUrl} imageVersion={imageVersion} shape="circle" size={COLLECTION_HEADER_ICON_SIZE} />
      </View>
      <Text accessibilityLabel={name} accessibilityRole="header" ellipsizeMode="tail" numberOfLines={2} style={styles.title} testID="collection-details-title">
        {name}
      </Text>
      {isLocked ? (
        <View accessibilityLabel={t('collections.lockedA11y')} style={styles.icon} testID="collection-details-locked">
          <LockIcon color={colors.textSecondary} size={18} />
        </View>
      ) : null}
    </View>
  );
}

const styles = themedStyles(() => ({
  row: { alignItems: 'center', flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.sm },
  icon: { flexShrink: 0 },
  title: { color: colors.textPrimary, flex: 1, minWidth: 0, fontSize: 20, fontWeight: '700' },
}));
