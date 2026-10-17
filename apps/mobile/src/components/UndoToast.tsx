import { useEffect } from 'react';
import { Animated, Pressable, Text } from 'react-native';
import { colors, spacing, themedStyles } from '../theme/tokens';
import { useAnimatedToastBottom } from './useAnimatedToastBottom';

export const UNDO_TOAST_DURATION_MS = 5000;

/**
 * `bottomOffset` is the distance from the screen's bottom edge to the top of whatever app UI
 * already occupies that space (a bottom tab bar via useBottomTabBarHeight - already inclusive of
 * the safe-area inset, a fixed bottom action bar's own measured height, or just the safe-area
 * inset on a screen with neither) - the caller computes it, this component only adds the one
 * shared gap on top, so safe-area/tab-bar height is never accounted for twice.
 */
export function UndoToast({ message, actionLabel, onUndo, onDismiss, isUndoing, bottomOffset }: { readonly message: string; readonly actionLabel: string; readonly onUndo: () => void; readonly onDismiss: () => void; readonly isUndoing: boolean; readonly bottomOffset: number }) {
  useEffect(() => { const timeout = setTimeout(onDismiss, UNDO_TOAST_DURATION_MS); return () => clearTimeout(timeout); }, [onDismiss]);
  const bottom = useAnimatedToastBottom(bottomOffset + spacing.lg);
  return <Animated.View style={[styles.surface, { bottom }]}><Text style={styles.message}>{message}</Text><Pressable accessibilityRole="button" accessibilityLabel={actionLabel} disabled={isUndoing} onPress={onUndo} style={styles.action}><Text style={styles.actionText}>{actionLabel}</Text></Pressable></Animated.View>;
}

const styles = themedStyles(() => ({ surface: { position: 'absolute', alignSelf: 'center', flexDirection: 'row', alignItems: 'center', backgroundColor: colors.textPrimary, borderRadius: 14, paddingLeft: 18, paddingRight: 10, paddingVertical: 10, maxWidth: '92%' }, message: { color: colors.textInverse, fontSize: 14, fontWeight: '600', flexShrink: 1 }, action: { paddingHorizontal: 10, paddingVertical: 4, marginLeft: 8 }, actionText: { color: '#60A5FA', fontSize: 14, fontWeight: '700' } }));
