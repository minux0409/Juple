import { useEffect } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { spacing } from '../theme/tokens';

export const NOTIFICATION_TOAST_DURATION_MS = 3000;

/** See UndoToast's own remark on `bottomOffset` - same contract, same shared gap. */
export function NotificationToast({ message, onDismiss, bottomOffset }: { readonly message: string; readonly onDismiss: () => void; readonly bottomOffset: number }) {
  useEffect(() => { const timeout = setTimeout(onDismiss, NOTIFICATION_TOAST_DURATION_MS); return () => clearTimeout(timeout); }, [onDismiss]);
  return <View pointerEvents="none" style={[styles.surface, { bottom: bottomOffset + spacing.lg }]}><Text style={styles.message}>{message}</Text></View>;
}

const styles = StyleSheet.create({ surface: { position: 'absolute', alignSelf: 'center', backgroundColor: '#1F2937', borderRadius: 14, paddingHorizontal: 18, paddingVertical: 12, maxWidth: '88%' }, message: { color: '#FFFFFF', fontSize: 14, fontWeight: '600' } });
