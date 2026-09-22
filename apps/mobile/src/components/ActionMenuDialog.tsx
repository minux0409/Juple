import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, radii, spacing } from '../theme/tokens';

export interface ActionMenuDialogAction {
  readonly label: string;
  readonly destructive?: boolean;
  readonly onPress: () => void;
}

export function ActionMenuDialog({ visible, title, actions, cancelLabel, onCancel }: {
  readonly visible: boolean;
  readonly title?: string;
  readonly actions: readonly ActionMenuDialogAction[];
  readonly cancelLabel: string;
  readonly onCancel: () => void;
}) {
  return <Modal animationType="fade" onRequestClose={onCancel} transparent visible={visible}>
    <View style={styles.overlay}><Pressable accessibilityElementsHidden importantForAccessibility="no-hide-descendants" onPress={onCancel} style={StyleSheet.absoluteFill} /><View accessibilityViewIsModal style={styles.card}>
      {title ? <Text style={styles.title}>{title}</Text> : null}
      {actions.map(action => <Pressable accessibilityLabel={action.label} accessibilityRole="button" key={action.label} onPress={action.onPress} style={styles.action}>
        <Text style={[styles.label, action.destructive && styles.destructive]}>{action.label}</Text>
      </Pressable>)}
      <Pressable accessibilityRole="button" onPress={onCancel} style={styles.cancel}><Text style={styles.label}>{cancelLabel}</Text></Pressable>
    </View></View>
  </Modal>;
}

const styles = StyleSheet.create({
  overlay: { alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.4)', flex: 1, justifyContent: 'center', padding: spacing.xl },
  card: { backgroundColor: colors.surface, borderRadius: radii.lg, minWidth: 260, padding: spacing.md, width: '100%' },
  title: { color: colors.textPrimary, fontSize: 17, fontWeight: '700', marginBottom: spacing.sm },
  action: { paddingHorizontal: spacing.md, paddingVertical: spacing.md },
  cancel: { borderTopColor: colors.divider, borderTopWidth: 1, marginTop: spacing.sm, paddingHorizontal: spacing.md, paddingTop: spacing.md },
  label: { color: colors.textPrimary, fontSize: 16, fontWeight: '600', textAlign: 'center' },
  destructive: { color: colors.danger },
});
