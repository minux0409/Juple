import { useEffect } from 'react';
import { AccessibilityInfo, ActivityIndicator, Modal, StyleSheet, Text, View } from 'react-native';
import { colors, radii, spacing } from '../theme/tokens';
import { APP_MODAL_BACKDROP } from './AppModal';

interface BlockingProgressOverlayProps {
  readonly visible: boolean;
  /** What is happening, e.g. "삭제 중..." - also announced to screen readers when it appears. */
  readonly message: string;
  readonly testID?: string;
}

/**
 * A blocking "work in progress" layer for one long operation: a dim backdrop over the whole screen
 * (status/navigation bars included - it is a transparent Modal), a centered spinner and its message.
 * Being a Modal it takes every touch (header, tab bar, list) and the Android back button does
 * nothing while it is up, so the operation can be neither repeated nor interrupted. Not dismissible
 * by the user - the caller removes it when the operation settles.
 */
export function BlockingProgressOverlay({ visible, message, testID = 'blocking-progress' }: BlockingProgressOverlayProps) {
  useEffect(() => {
    if (visible) {
      AccessibilityInfo.announceForAccessibility(message);
    }
  }, [message, visible]);

  return (
    <Modal animationType="none" navigationBarTranslucent onRequestClose={() => undefined} statusBarTranslucent transparent visible={visible}>
      <View accessibilityViewIsModal style={styles.backdrop} testID={testID}>
        <View
          accessibilityLabel={message}
          accessibilityLiveRegion="polite"
          accessibilityState={{ busy: true }}
          accessible
          style={styles.card}
        >
          <ActivityIndicator color={colors.brand} size="large" />
          <Text style={styles.message}>{message}</Text>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { alignItems: 'center', backgroundColor: APP_MODAL_BACKDROP, flex: 1, justifyContent: 'center', padding: spacing.xl },
  card: { alignItems: 'center', backgroundColor: colors.surface, borderRadius: radii.lg, gap: spacing.md, maxWidth: 280, paddingHorizontal: spacing.xl, paddingVertical: spacing.xl },
  message: { color: colors.textPrimary, fontSize: 15, fontWeight: '600', textAlign: 'center' },
});
