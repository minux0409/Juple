import { useTranslation } from 'react-i18next';
import { ActivityIndicator, StyleSheet, Switch, Text, View } from 'react-native';
import { AppModal } from '../components/AppModal';
import { colors, minTouchTarget, spacing } from '../theme/tokens';

interface CollectionNotificationDialogProps {
  readonly visible: boolean;
  /** Null while the caller's current setting is still loading. */
  readonly enabled: boolean | null;
  readonly error: string | null;
  readonly onChange: (enabled: boolean) => void;
  readonly onClose: () => void;
}

/**
 * 새 링크 알림 for one Collection - the caller's own setting only (the Owner and each member have
 * their own). The switch flips at once; the screen saves it and flips it back if the save fails.
 */
export function CollectionNotificationDialog({ visible, enabled, error, onChange, onClose }: CollectionNotificationDialogProps) {
  const { t } = useTranslation();
  return (
    <AppModal onClose={onClose} testID="collection-notification-dialog" title={t('collections.newLinkNotifications')} visible={visible}>
      <View style={styles.row}>
        <Text style={styles.description}>{t('collections.newLinkNotificationsDescription')}</Text>
        {enabled === null ? (
          <ActivityIndicator />
        ) : (
          <Switch
            accessibilityLabel={t('collections.newLinkNotifications')}
            onValueChange={onChange}
            testID="collection-notification-switch"
            value={enabled}
          />
        )}
      </View>
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </AppModal>
  );
}

const styles = StyleSheet.create({
  row: { alignItems: 'center', flexDirection: 'row', gap: spacing.md, minHeight: minTouchTarget },
  description: { color: colors.textSecondary, flex: 1, flexShrink: 1, fontSize: 14, lineHeight: 20 },
  error: { color: colors.danger, fontSize: 13, marginTop: spacing.sm },
});
