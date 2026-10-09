import type { ReactNode } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, radii, spacing } from '../theme/tokens';
import { DialogActions } from './DialogActions';

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
  /** Optional content between the message and the buttons (e.g. a Collection's profile) - the dialog stays the one shared shape. */
  readonly children?: ReactNode;
}

/**
 * Juple's one shared dialog for every app-owned confirmation/alert (item delete, account delete,
 * unsaved changes, sign-out, ...) - replaces per-screen native Alert.alert calls so wording/styling
 * stays identical everywhere. New app-owned confirmations/alerts should use this component rather
 * than Alert.alert or a bespoke Modal. OS-owned UI (permission dialogs, share sheet, image picker,
 * browser, auth system UI) is out of scope and must stay native.
 *
 * Two shapes: a two-button confirm (cancelLabel + onCancel both provided) or a single-button,
 * alert-only variant (both omitted) for a notice with no cancel action. The buttons are the shared
 * DialogActions - centered labels that wrap, stacking only when a long translation needs it.
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
  children,
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
          {/* An empty message means a title-only confirmation. */}
          {message ? <Text style={styles.message}>{message}</Text> : null}
          {children}
          <View style={styles.actions}>
            <DialogActions
              actions={[
                ...(onCancel && cancelLabel ? [{ label: cancelLabel, onPress: onCancel, tone: 'secondary' as const }] : []),
                { label: confirmLabel, onPress: onConfirm, tone: destructive ? ('destructive' as const) : ('neutral' as const) },
              ]}
            />
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
  actions: {
    marginTop: spacing.xl,
  },
});
