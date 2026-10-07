import { useEffect } from 'react';
import { Animated, StyleSheet, Text } from 'react-native';
import { spacing } from '../theme/tokens';
import { useAnimatedToastBottom } from './useAnimatedToastBottom';

export const NOTIFICATION_TOAST_DURATION_MS = 3000;

/** See UndoToast's own remark on `bottomOffset` - same contract, same shared gap. */
export function NotificationToast({ message, onDismiss, bottomOffset }: { readonly message: string; readonly onDismiss: () => void; readonly bottomOffset: number }) {
  useEffect(() => { const timeout = setTimeout(onDismiss, NOTIFICATION_TOAST_DURATION_MS); return () => clearTimeout(timeout); }, [onDismiss]);
  const bottom = useAnimatedToastBottom(bottomOffset + spacing.lg);
  return <Animated.View pointerEvents="none" style={[styles.surface, { bottom }]} testID="notification-toast"><Text style={styles.message}>{message}</Text></Animated.View>;
}

const styles = StyleSheet.create({ surface: { position: 'absolute', alignSelf: 'center', backgroundColor: '#1F2937', borderRadius: 14, paddingHorizontal: 18, paddingVertical: 12, maxWidth: '88%' }, message: { color: '#FFFFFF', fontSize: 14, fontWeight: '600' } });
