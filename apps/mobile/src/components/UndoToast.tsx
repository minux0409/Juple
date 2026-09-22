import { useEffect } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export const UNDO_TOAST_DURATION_MS = 5000;

export function UndoToast({ message, actionLabel, onUndo, onDismiss, isUndoing }: { readonly message: string; readonly actionLabel: string; readonly onUndo: () => void; readonly onDismiss: () => void; readonly isUndoing: boolean }) {
  const insets = useSafeAreaInsets();
  useEffect(() => { const timeout = setTimeout(onDismiss, UNDO_TOAST_DURATION_MS); return () => clearTimeout(timeout); }, [onDismiss]);
  return <View style={[styles.surface, { bottom: insets.bottom + 16 }]}><Text style={styles.message}>{message}</Text><Pressable accessibilityRole="button" accessibilityLabel={actionLabel} disabled={isUndoing} onPress={onUndo} style={styles.action}><Text style={styles.actionText}>{actionLabel}</Text></Pressable></View>;
}

const styles = StyleSheet.create({ surface: { position: 'absolute', alignSelf: 'center', flexDirection: 'row', alignItems: 'center', backgroundColor: '#1F2937', borderRadius: 14, paddingLeft: 18, paddingRight: 10, paddingVertical: 10, maxWidth: '92%' }, message: { color: '#FFFFFF', fontSize: 14, fontWeight: '600', flexShrink: 1 }, action: { paddingHorizontal: 10, paddingVertical: 4, marginLeft: 8 }, actionText: { color: '#60A5FA', fontSize: 14, fontWeight: '700' } });
