import { useTranslation } from 'react-i18next';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ShareIcon } from '../icons/ShareIcon';
import { TrashIcon } from '../icons/TrashIcon';
import { colors, minTouchTarget, spacing } from '../theme/tokens';

interface RowActionSheetProps {
  readonly visible: boolean;
  readonly onClose: () => void;
  readonly onShare: () => void;
  readonly onDelete: () => void;
}

/**
 * Bottom action sheet replacing a row's always-visible share/delete buttons - built from the same
 * slide-up Modal shell already used by ItemDetailsScreen's collection-picker modal.
 */
export function RowActionSheet({ visible, onClose, onShare, onDelete }: RowActionSheetProps) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();

  return (
    <Modal animationType="slide" onRequestClose={onClose} transparent visible={visible}>
      <Pressable onPress={onClose} style={styles.overlay}>
        <View style={[styles.content, { paddingBottom: spacing.md + insets.bottom }]}>
          <Pressable
            accessibilityRole="button"
            onPress={() => {
              onClose();
              onShare();
            }}
            style={styles.actionRow}
          >
            <ShareIcon color={colors.textPrimary} size={20} />
            <Text style={styles.actionLabel}>{t('item.share')}</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            onPress={() => {
              onClose();
              onDelete();
            }}
            style={styles.actionRow}
          >
            <TrashIcon color={colors.danger} size={20} />
            <Text style={[styles.actionLabel, styles.deleteLabel]}>{t('common.delete')}</Text>
          </Pressable>
        </View>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    backgroundColor: 'rgba(0, 0, 0, 0.4)',
    flex: 1,
    justifyContent: 'flex-end',
  },
  content: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.lg,
  },
  actionRow: {
    alignItems: 'center',
    flexDirection: 'row',
    minHeight: minTouchTarget,
  },
  actionLabel: {
    color: colors.textPrimary,
    fontSize: 16,
    fontWeight: '600',
    marginStart: spacing.md,
  },
  deleteLabel: {
    color: colors.danger,
  },
});
