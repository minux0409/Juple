import type { ComponentProps } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, Text } from 'react-native';
import { AppModal } from '../components/AppModal';
import { colors, minTouchTarget, radii, themedStyles } from '../theme/tokens';
import { CollectionUnlockPanel } from './CollectionUnlockPanel';

interface CollectionUnlockModalProps extends Omit<ComponentProps<typeof CollectionUnlockPanel>, 'embedded' | 'hideTitle'> {
  readonly visible: boolean;
  /** The Collection's name: it becomes the modal title. Without one the title is the lock prompt itself. */
  readonly collectionName?: string;
  readonly onCancel: () => void;
  readonly testID?: string;
}

/**
 * The one password prompt for touching a protected Collection from outside it, on Juple's standard AppModal:
 * name (title), lock icon, message, password, 잠금 해제 and 취소 all sit inside the one card, which moves above
 * the keyboard and scrolls instead of cutting a button off on a small screen.
 */
export function CollectionUnlockModal({ visible, collectionName, onCancel, testID, ...panelProps }: CollectionUnlockModalProps) {
  const { t } = useTranslation();
  const isSharePassword = panelProps.kind === 'sharePassword';
  const title = collectionName ?? t(isSharePassword ? 'collections.sharePasswordLockedTitle' : 'collections.lockedTitle');
  return (
    <AppModal
      footer={
        <Pressable accessibilityRole="button" onPress={onCancel} style={styles.cancel} testID={testID ? `${testID}-cancel` : undefined}>
          <Text style={styles.cancelLabel}>{t('common.cancel')}</Text>
        </Pressable>
      }
      onClose={onCancel}
      testID={testID}
      title={title}
      visible={visible}
    >
      <ScrollView bounces={false} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        <CollectionUnlockPanel {...panelProps} embedded hideTitle={collectionName === undefined} />
      </ScrollView>
    </AppModal>
  );
}

const styles = themedStyles(() => ({
  cancel: { alignItems: 'center', borderColor: colors.border, borderRadius: radii.md, borderWidth: 1, flex: 1, justifyContent: 'center', minHeight: minTouchTarget },
  cancelLabel: { color: colors.textPrimary, fontSize: 15, fontWeight: '600', textAlign: 'center' },
}));
