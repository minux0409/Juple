import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { PlusIcon } from '../icons/PlusIcon';
import { colors, minTouchTarget, radii, spacing } from '../theme/tokens';
import { emojiOfReaction, QUICK_REACTION_KEYS } from './reactionCatalog';

interface QuickReactionBarProps {
  /** The caller's current reaction to this link (null = none) - drawn as selected when it is in the quick set. */
  readonly myReaction: string | null;
  readonly onSelect: (key: string) => void;
  /** "+": the full picker. */
  readonly onMore: () => void;
}

/**
 * The fixed quick row at the top of a link's long-press menu: [❤️] [👍] [✅] [😂] [😮] [😢] [+].
 * Each reaction is a 44dp target with a larger emoji; the caller's own is marked with a soft ring
 * (never a loud fill). The emoji is read by the screen reader in the device's own language, with
 * "내가 선택한" in front of the selected one.
 */
export function QuickReactionBar({ myReaction, onSelect, onMore }: QuickReactionBarProps) {
  const { t } = useTranslation();
  return (
    <View accessibilityRole="toolbar" style={styles.row} testID="quick-reactions">
      {QUICK_REACTION_KEYS.map(key => {
        const emoji = emojiOfReaction(key) ?? '';
        const isMine = myReaction === key;
        return (
          <Pressable
            accessibilityLabel={t(isMine ? 'reactions.mineA11y' : 'reactions.reactionA11y', { emoji })}
            accessibilityRole="button"
            accessibilityState={{ selected: isMine }}
            key={key}
            onPress={() => onSelect(key)}
            style={[styles.cell, isMine && styles.cellMine]}
            testID={`quick-reaction-${key}`}
          >
            <Text allowFontScaling={false} style={styles.emoji}>{emoji}</Text>
          </Pressable>
        );
      })}
      <Pressable
        accessibilityLabel={t('reactions.addMoreA11y')}
        accessibilityRole="button"
        onPress={onMore}
        style={styles.cell}
        testID="quick-reaction-more"
      >
        <PlusIcon color={colors.textSecondary} size={20} strokeWidth={2} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  // Seven equal cells share the row; each stays at least a touch target wide on a narrow screen.
  row: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: spacing.xs, paddingVertical: spacing.xs },
  cell: {
    alignItems: 'center',
    borderColor: 'transparent',
    borderRadius: radii.lg,
    borderWidth: 1,
    flex: 1,
    height: minTouchTarget,
    justifyContent: 'center',
    minWidth: 0,
  },
  cellMine: { backgroundColor: colors.brandSoft, borderColor: colors.brand },
  emoji: { fontSize: 22 },
});
