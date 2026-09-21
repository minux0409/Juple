import { StyleSheet, Text, View } from 'react-native';
import { colors, radii, spacing } from '../theme/tokens';

interface StatusToastProps {
  readonly message: string;
  /** Defaults to 'success' (ItemDetailsScreen's original, only use so far). 'error' reuses the same
   * always-visible-regardless-of-scroll treatment for a failure that would otherwise be an
   * easy-to-miss inline text (e.g. CollectionDetailsScreen's color-update failure). */
  readonly tone?: 'success' | 'error';
}

/**
 * A compact, hard-to-miss status confirmation - e.g. ItemDetailsScreen's post-Save "저장되었습니다."
 * Deliberately just a styled View+Text (no timers/animation/portal/queue - a screen still owns its
 * own visibility state and clears it itself, exactly as ItemDetailsScreen's justSaved already did),
 * so any other screen with the same "briefly confirm a save succeeded/failed" need can reuse this
 * instead of each screen inventing its own inline text treatment.
 */
export function StatusToast({ message, tone = 'success' }: StatusToastProps) {
  return (
    <View style={[styles.container, tone === 'error' && styles.containerError]}>
      <Text style={[styles.text, tone === 'error' && styles.textError]}>{message}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    backgroundColor: '#E7F6EC',
    borderRadius: radii.md + 4,
    marginBottom: spacing.sm,
    marginHorizontal: spacing.xl,
    paddingVertical: spacing.sm,
  },
  containerError: {
    backgroundColor: '#FDECEA',
  },
  text: {
    color: colors.success,
    fontSize: 14,
    fontWeight: '700',
  },
  textError: {
    color: colors.danger,
  },
});
