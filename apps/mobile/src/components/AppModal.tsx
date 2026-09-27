import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { KeyboardAvoidingView, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CloseIcon } from '../icons/CloseIcon';
import { colors, minTouchTarget, radii, spacing } from '../theme/tokens';

export const APP_MODAL_BACKDROP = 'rgba(0, 0, 0, 0.35)';

interface AppModalProps {
  readonly visible: boolean;
  readonly title: string;
  /** X, Android back and a backdrop tap all call this - unless dismissible is false. */
  readonly onClose: () => void;
  /** False while something must not be interrupted (a save in flight, an open confirmation). */
  readonly dismissible?: boolean;
  /** "large": up to ~80% of the screen height for long lists; "compact": sized to its content. */
  readonly size?: 'compact' | 'large';
  /** Pinned under the content (never scrolls away), e.g. [취소] [3명 추가]. */
  readonly footer?: ReactNode;
  readonly children: ReactNode;
  readonly testID?: string;
}

/**
 * Juple's standard centered modal (replaces bottom sheets): the dim backdrop covers the whole
 * viewport at once - including under the status and navigation bars (statusBarTranslucent /
 * navigationBarTranslucent), and only fades, never slides up with the content. The card sits inside
 * the real safe-area insets, so neither its content nor its footer can end up behind the system
 * navigation bar, gesture area or home indicator, and it moves up with the keyboard (edge-to-edge
 * Android no longer resizes the window for it; "padding" is zero wherever the window does resize).
 */
export function AppModal({ visible, title, onClose, dismissible = true, size = 'compact', footer, children, testID }: AppModalProps) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const close = dismissible ? onClose : () => undefined;

  return (
    <Modal
      animationType="fade"
      navigationBarTranslucent
      onRequestClose={close}
      statusBarTranslucent
      transparent
      visible={visible}
    >
      <View style={styles.backdrop} testID={testID ? `${testID}-backdrop` : undefined}>
        <Pressable
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          onPress={close}
          style={StyleSheet.absoluteFill}
          testID={testID ? `${testID}-backdrop-press` : undefined}
        />
        <KeyboardAvoidingView
          behavior="padding"
          pointerEvents="box-none"
          style={[
            styles.frame,
            {
              paddingTop: insets.top + spacing.lg,
              paddingBottom: insets.bottom + spacing.lg,
              paddingLeft: insets.left + spacing.lg,
              paddingRight: insets.right + spacing.lg,
            },
          ]}
        >
          <View accessibilityViewIsModal style={[styles.card, size === 'large' && styles.cardLarge]} testID={testID}>
            <View style={styles.header}>
              <Text accessibilityRole="header" numberOfLines={2} style={styles.title}>{title}</Text>
              <Pressable
                accessibilityLabel={t('common.close')}
                accessibilityRole="button"
                disabled={!dismissible}
                hitSlop={8}
                onPress={close}
                style={styles.closeButton}
                testID={testID ? `${testID}-close` : undefined}
              >
                <CloseIcon color={colors.textSecondary} size={20} />
              </Pressable>
            </View>
            <View style={[styles.body, size === 'large' && styles.bodyLarge]}>{children}</View>
            {footer ? <View style={styles.footer}>{footer}</View> : null}
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { backgroundColor: APP_MODAL_BACKDROP, flex: 1 },
  frame: { alignItems: 'center', flex: 1, justifyContent: 'center' },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    maxHeight: '100%',
    maxWidth: 480,
    padding: spacing.xl,
    width: '100%',
  },
  cardLarge: { height: '80%' },
  header: { alignItems: 'center', flexDirection: 'row', gap: spacing.sm },
  title: { color: colors.textPrimary, flex: 1, fontSize: 18, fontWeight: '700' },
  closeButton: { alignItems: 'center', height: minTouchTarget, justifyContent: 'center', marginEnd: -spacing.sm, width: minTouchTarget },
  body: { flexShrink: 1, marginTop: spacing.sm },
  bodyLarge: { flex: 1 },
  footer: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md },
});
