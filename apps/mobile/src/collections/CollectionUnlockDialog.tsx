import { useTranslation } from 'react-i18next';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, minTouchTarget, spacing } from '../theme/tokens';
import type { Collection } from './api/collectionsApi';
import { isSharedWithMe } from './collectionAccess';
import { CollectionUnlockPanel } from './CollectionUnlockPanel';

interface CollectionUnlockDialogProps {
  /** The locked Collection to ask the password for; null = closed. */
  readonly collection: Collection | null;
  /** Receives the grant - it is handed to the caller only, never stored for anything else. */
  readonly onGranted: (unlockToken: string) => void;
  readonly onCancel: () => void;
}

/**
 * The password prompt for touching a locked Collection from outside it (the Collection picker):
 * a correct password resolves with a grant for the caller; a wrong one keeps the prompt open with
 * the reason, and cancelling changes nothing.
 */
export function CollectionUnlockDialog({ collection, onGranted, onCancel }: CollectionUnlockDialogProps) {
  const { t } = useTranslation();
  return (
    <Modal animationType="fade" onRequestClose={onCancel} transparent visible={collection !== null}>
      <View style={styles.overlay}>
        {collection ? (
          <View style={styles.container} testID="collection-unlock-dialog">
            <Text numberOfLines={2} style={styles.name}>{collection.name}</Text>
            <CollectionUnlockPanel
              collectionId={collection.id}
              isOwner={!isSharedWithMe(collection)}
              onGranted={onGranted}
              onUnlocked={() => undefined}
            />
            <Pressable accessibilityRole="button" onPress={onCancel} style={styles.cancel} testID="collection-unlock-dialog-cancel">
              <Text style={styles.cancelLabel}>{t('common.cancel')}</Text>
            </Pressable>
          </View>
        ) : null}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.4)', flex: 1, justifyContent: 'center', padding: spacing.xl },
  container: { maxWidth: 420, width: '100%' },
  name: { color: colors.surface, fontSize: 16, fontWeight: '700', textAlign: 'center' },
  cancel: { alignItems: 'center', justifyContent: 'center', marginTop: spacing.sm, minHeight: minTouchTarget },
  cancelLabel: { color: colors.surface, fontSize: 16, fontWeight: '600' },
});
