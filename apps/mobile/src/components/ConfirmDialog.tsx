import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, radii, spacing } from '../theme/tokens';

interface ConfirmDialogProps {
  readonly visible: boolean;
  readonly title: string;
  readonly message: string;
  /** Omit together with onCancel to render a single-button, alert-only variant (no cancel action). */
  readonly cancelLabel?: string;
  readonly confirmLabel: string;
  readonly onCancel?: () => void;
  readonly onConfirm: () => void;
  /** Styles the confirm button as the destructive action (default). Set false for a neutral confirm. */
  readonly destructive?: boolean;
}

/**
 * Juple's one shared dialog for every app-owned confirmation/alert (item delete, account delete,
 * unsaved changes, sign-out, ...) - replaces per-screen native Alert.alert calls so wording/styling
 * stays identical everywhere. New app-owned confirmations/alerts should use this component rather
 * than Alert.alert or a bespoke Modal. OS-owned UI (permission dialogs, share sheet, image picker,
 * browser, auth system UI) is out of scope and must stay native.
 *
 * Two shapes: a two-button confirm (cancelLabel + onCancel both provided) or a single-button,
 * alert-only variant (both omitted) for a notice with no cancel action.
 */
export function ConfirmDialog({
  visible,
  title,
  message,
  cancelLabel,
  confirmLabel,
  onCancel,
  onConfirm,
  destructive = true,
}: ConfirmDialogProps) {
  const dismiss = onCancel ?? onConfirm;

  return (
    <Modal animationType="fade" onRequestClose={dismiss} transparent visible={visible}>
      <View style={styles.overlay}>
        <Pressable
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          onPress={dismiss}
          style={StyleSheet.absoluteFill}
        />
        <View accessibilityViewIsModal style={styles.card}>
          <Text style={styles.title}>{title}</Text>
          <Text style={styles.message}>{message}</Text>
          <View style={styles.buttonRow}>
            {onCancel && cancelLabel ? (
              <Pressable
                accessibilityLabel={cancelLabel}
                accessibilityRole="button"
                onPress={onCancel}
                style={styles.cancelButton}
              >
                <Text style={styles.cancelButtonLabel}>{cancelLabel}</Text>
              </Pressable>
            ) : null}
            <Pressable
              accessibilityLabel={confirmLabel}
              accessibilityRole="button"
              onPress={onConfirm}
              style={[styles.confirmButton, destructive ? styles.confirmButtonDestructive : styles.confirmButtonNeutral]}
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
    borderRadius: radii.md,
    flex: 1,
    justifyContent: 'center',
    paddingVertical: spacing.sm + 4,
  },
  confirmButtonDestructive: {
    backgroundColor: colors.danger,
  },
  confirmButtonNeutral: {
    backgroundColor: colors.textPrimary,
  },
  confirmButtonLabel: {
    color: colors.surface,
    fontSize: 16,
    fontWeight: '600',
  },
});
