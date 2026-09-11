import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, radii, spacing } from '../theme/tokens';

interface ConfirmDialogProps {
  readonly visible: boolean;
  readonly title: string;
  readonly message: string;
  readonly cancelLabel: string;
  readonly confirmLabel: string;
  readonly onCancel: () => void;
  readonly onConfirm: () => void;
}

/**
 * Juple's one shared destructive-confirmation dialog (item delete, account delete, ...) - replaces
 * per-screen native Alert.alert calls so the wording/styling stays identical everywhere it's used.
 * Confirm is always styled as the destructive action; there is no non-destructive variant because
 * every current call site needs one.
 */
export function ConfirmDialog({
  visible,
  title,
  message,
  cancelLabel,
  confirmLabel,
  onCancel,
  onConfirm,
}: ConfirmDialogProps) {
  return (
    <Modal animationType="fade" onRequestClose={onCancel} transparent visible={visible}>
      <View style={styles.overlay}>
        <Pressable
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          onPress={onCancel}
          style={StyleSheet.absoluteFill}
        />
        <View accessibilityViewIsModal style={styles.card}>
          <Text style={styles.title}>{title}</Text>
          <Text style={styles.message}>{message}</Text>
          <View style={styles.buttonRow}>
            <Pressable
              accessibilityLabel={cancelLabel}
              accessibilityRole="button"
              onPress={onCancel}
              style={styles.cancelButton}
            >
              <Text style={styles.cancelButtonLabel}>{cancelLabel}</Text>
            </Pressable>
            <Pressable
              accessibilityLabel={confirmLabel}
              accessibilityRole="button"
              onPress={onConfirm}
              style={styles.confirmButton}
            >
              <Text style={styles.confirmButtonLabel}>{confirmLabel}</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.4)',
    flex: 1,
    justifyContent: 'center',
    padding: spacing.xl,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    // Full width on phones (inside the overlay's padding), but capped on large/unfolded screens -
    // without the cap the card stretches to nearly the whole ~840dp width of an unfolded foldable
    // and stops reading as a dialog.
    maxWidth: 400,
    padding: spacing.xl,
    width: '100%',
  },
  title: {
    color: colors.textPrimary,
    fontSize: 17,
    fontWeight: '700',
  },
  message: {
    color: colors.textSecondary,
    fontSize: 14,
    marginTop: spacing.sm,
  },
  buttonRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.xl,
  },
  cancelButton: {
    alignItems: 'center',
    borderColor: colors.border,
    borderRadius: radii.md,
    borderWidth: 1,
    flex: 1,
    justifyContent: 'center',
    paddingVertical: spacing.sm + 4,
  },
  cancelButtonLabel: {
    color: colors.textPrimary,
    fontSize: 16,
    fontWeight: '600',
  },
  confirmButton: {
    alignItems: 'center',
    backgroundColor: colors.danger,
    borderRadius: radii.md,
    flex: 1,
    justifyContent: 'center',
    paddingVertical: spacing.sm + 4,
  },
  confirmButtonLabel: {
    color: colors.surface,
    fontSize: 16,
    fontWeight: '600',
  },
});
