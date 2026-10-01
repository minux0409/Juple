import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { CloseIcon } from '../icons/CloseIcon';
import { colors, minTouchTarget, radii, spacing } from '../theme/tokens';
import { emojiOfReaction, REACTION_CATALOG } from './reactionCatalog';

interface ReactionPickerDialogProps {
  readonly visible: boolean;
  readonly myReaction: string | null;
  /** This device's recently used reactions, newest first - the section is hidden when there are none. */
  readonly recent: readonly string[];
  readonly onSelect: (key: string) => void;
  readonly onClose: () => void;
}

/**
 * "리액션 추가": the whole catalog as a grid, with this device's 최근 사용 on top. It appears at once
 * (no slide-up - a window-wide slide would drag the dim backdrop up with it), centered on a dimmed
 * screen; choosing a reaction closes it (the caller applies it). No search, GIFs or custom emoji.
 */
export function ReactionPickerDialog({ visible, myReaction, recent, onSelect, onClose }: ReactionPickerDialogProps) {
  const { t } = useTranslation();
  const recentKeys = recent.filter(key => emojiOfReaction(key) !== null);

  const cell = (key: string, testPrefix: string) => {
    const emoji = emojiOfReaction(key) ?? '';
    const isMine = myReaction === key;
    return (
      <Pressable
        accessibilityLabel={t(isMine ? 'reactions.mineA11y' : 'reactions.reactionA11y', { emoji })}
        accessibilityRole="button"
        accessibilityState={{ selected: isMine }}
        key={`${testPrefix}-${key}`}
        onPress={() => onSelect(key)}
        style={[styles.cell, isMine && styles.cellMine]}
        testID={`${testPrefix}-${key}`}
      >
        <Text allowFontScaling={false} style={styles.emoji}>{emoji}</Text>
      </Pressable>
    );
  };

  return (
    <Modal animationType="none" onRequestClose={onClose} transparent visible={visible}>
      <View style={styles.overlay}>
        <Pressable accessibilityElementsHidden importantForAccessibility="no-hide-descendants" onPress={onClose} style={StyleSheet.absoluteFill} />
        <View accessibilityViewIsModal style={styles.card} testID="reaction-picker">
          <View style={styles.header}>
            <Text accessibilityRole="header" numberOfLines={2} style={styles.title}>{t('reactions.pickerTitle')}</Text>
            <Pressable accessibilityLabel={t('common.close')} accessibilityRole="button" hitSlop={8} onPress={onClose} style={styles.close} testID="reaction-picker-close">
              <CloseIcon color={colors.textSecondary} size={20} />
            </Pressable>
          </View>
          <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
            {recentKeys.length > 0 ? (
              <View testID="reaction-picker-recent-section">
                <Text style={styles.section}>{t('reactions.recent')}</Text>
                <View style={styles.grid}>{recentKeys.map(key => cell(key, 'reaction-recent'))}</View>
              </View>
            ) : null}
            <Text style={styles.section}>{t('reactions.all')}</Text>
            <View style={styles.grid}>{REACTION_CATALOG.map(reaction => cell(reaction.key, 'reaction-option'))}</View>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.4)', flex: 1, justifyContent: 'center', padding: spacing.xl },
  // Capped for large screens; never taller than the screen - the body scrolls.
  card: { backgroundColor: colors.surface, borderRadius: radii.lg, maxHeight: '80%', maxWidth: 420, padding: spacing.lg, width: '100%' },
  header: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
  title: { color: colors.textPrimary, flex: 1, flexShrink: 1, fontSize: 18, fontWeight: '700' },
  close: { alignItems: 'center', height: minTouchTarget, justifyContent: 'center', width: minTouchTarget },
  body: { paddingBottom: spacing.xs },
  section: { color: colors.textSecondary, fontSize: 13, fontWeight: '700', marginBottom: spacing.xs, marginTop: spacing.md },
  // Six per row: each cell claims a sixth of the width.
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  cell: {
    alignItems: 'center',
    borderColor: 'transparent',
    borderRadius: radii.lg,
    borderWidth: 1,
    flexBasis: `${100 / 6}%`,
    height: minTouchTarget + 4,
    justifyContent: 'center',
  },
  cellMine: { backgroundColor: colors.brandSoft, borderColor: colors.brand },
  emoji: { fontSize: 26 },
});
