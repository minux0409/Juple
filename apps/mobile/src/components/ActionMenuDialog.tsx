import type { ComponentType } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, minTouchTarget, radii, spacing } from '../theme/tokens';

const ICON_SIZE = 20;

export interface ActionMenuDialogAction {
  readonly label: string;
  readonly destructive?: boolean;
  /**
   * An optional leading icon (one of src/icons), drawn in the row's own color - danger for a
   * destructive row. Decoration only: the whole row is the button and its label is what is announced.
   */
  readonly icon?: ComponentType<{ readonly color?: string; readonly size?: number }>;
  readonly onPress: () => void;
}

/**
 * A small centered menu of actions with 취소 at the bottom. A menu whose rows have icons lists them
 * start-aligned behind one icon column; a menu without icons keeps its centered labels.
 */
export function ActionMenuDialog({ visible, title, actions, cancelLabel, onCancel, onDismiss }: {
  readonly visible: boolean;
  readonly title?: string;
  readonly actions: readonly ActionMenuDialogAction[];
  readonly cancelLabel: string;
  readonly onCancel: () => void;
  /** iOS only (React Native's Modal): the menu has finished closing - see ProfileEditScreen for why that matters. */
  readonly onDismiss?: () => void;
}) {
  const hasIcons = actions.some(action => action.icon !== undefined);
  return <Modal animationType="fade" onDismiss={onDismiss} onRequestClose={onCancel} transparent visible={visible}>
    <View style={styles.overlay}><Pressable accessibilityElementsHidden importantForAccessibility="no-hide-descendants" onPress={onCancel} style={StyleSheet.absoluteFill} /><View accessibilityViewIsModal style={styles.card}>
      {title ? <Text style={styles.title}>{title}</Text> : null}
      {actions.map(action => {
        const color = action.destructive ? colors.danger : colors.textPrimary;
        const Icon = action.icon;
        return <Pressable
          accessibilityLabel={action.label}
          accessibilityRole="button"
          key={action.label}
          onPress={action.onPress}
          style={({ pressed }) => [styles.action, hasIcons && styles.actionWithIcon, pressed && styles.pressed]}
        >
          {hasIcons ? (
            <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={styles.icon}>
              {Icon ? <Icon color={color} size={ICON_SIZE} /> : null}
            </View>
          ) : null}
          <Text style={[styles.label, hasIcons && styles.labelWithIcon, { color }]}>{action.label}</Text>
        </Pressable>;
      })}
      <Pressable accessibilityRole="button" onPress={onCancel} style={styles.cancel}><Text style={styles.label}>{cancelLabel}</Text></Pressable>
    </View></View>
  </Modal>;
}

const styles = StyleSheet.create({
  overlay: { alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.4)', flex: 1, justifyContent: 'center', padding: spacing.xl },
  card: { backgroundColor: colors.surface, borderRadius: radii.lg, minWidth: 260, padding: spacing.md, width: '100%' },
  title: { color: colors.textPrimary, fontSize: 17, fontWeight: '700', marginBottom: spacing.sm },
  action: { borderRadius: radii.md, paddingHorizontal: spacing.md, paddingVertical: spacing.md },
  actionWithIcon: { alignItems: 'center', flexDirection: 'row', gap: spacing.md, minHeight: minTouchTarget },
  pressed: { backgroundColor: colors.surfaceMuted },
  icon: { alignItems: 'center', flexShrink: 0, height: ICON_SIZE + 2, justifyContent: 'center', width: ICON_SIZE + 2 },
  cancel: { borderTopColor: colors.divider, borderTopWidth: 1, marginTop: spacing.sm, paddingHorizontal: spacing.md, paddingTop: spacing.md },
  label: { color: colors.textPrimary, fontSize: 16, fontWeight: '600', textAlign: 'center' },
  labelWithIcon: { flex: 1, flexShrink: 1, textAlign: 'auto' },
});
