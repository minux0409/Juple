import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { SmileyPlusIcon } from '../icons/SmileyPlusIcon';
import { colors, radii, spacing } from '../theme/tokens';
import { emojiOfReaction, MAX_VISIBLE_REACTION_KINDS, summarizeForCard, type ItemReactions } from './reactionCatalog';

interface ReactionChipsProps {
  readonly reactions: ItemReactions;
  /** A chip was tapped: that reaction becomes the caller's (or is taken back when it already is). */
  readonly onToggle: (key: string) => void;
  /** The small smiley-plus: opens the picker for this link. */
  readonly onAdd: () => void;
  /** Draw the add affordance even when nobody reacted (the detail screen) - on a card it only follows existing chips. */
  readonly alwaysShowAdd?: boolean;
  readonly testID?: string;
}

/**
 * The reactions of one link as a small row of chips - "[❤️ 3] [👍 1] [😂 2] [+1] [☺+]": the most
 * used kinds first (ties in catalog order), at most MAX_VISIBLE_REACTION_KINDS of them, "+N" for the
 * kinds beyond, then the add affordance. The caller's own reaction is the chip with a ring and a
 * soft tint (never a loud fill). Nothing at all when nobody reacted (unless alwaysShowAdd), so a
 * link without reactions stays a clean card. The chips are visually compact; each reaches a 44dp
 * target through hitSlop. The emoji is read by the screen reader in the device's own language.
 */
export function ReactionChips({ reactions, onToggle, onAdd, alwaysShowAdd = false, testID = 'reaction-chips' }: ReactionChipsProps) {
  const { t } = useTranslation();
  const { visible, hiddenKinds } = summarizeForCard(reactions.reactions, MAX_VISIBLE_REACTION_KINDS);
  if (visible.length === 0 && !alwaysShowAdd) {
    return null;
  }

  return (
    <View style={styles.row} testID={testID}>
      {visible.map(reaction => {
        const emoji = emojiOfReaction(reaction.key) ?? '';
        const isMine = reactions.myReaction === reaction.key;
        return (
          <Pressable
            accessibilityLabel={t('reactions.chipA11y', { emoji, count: reaction.count })}
            accessibilityRole="button"
            accessibilityState={{ selected: isMine }}
            hitSlop={{ bottom: 10, top: 10 }}
            key={reaction.key}
            onPress={() => onToggle(reaction.key)}
            style={[styles.chip, isMine && styles.chipMine]}
            testID={`${testID}-${reaction.key}`}
          >
            <Text allowFontScaling={false} style={styles.emoji}>{emoji}</Text>
            <Text allowFontScaling={false} style={[styles.count, isMine && styles.countMine]}>{reaction.count}</Text>
          </Pressable>
        );
      })}
      {hiddenKinds > 0 ? (
        <View accessibilityLabel={t('reactions.moreKindsA11y', { count: hiddenKinds })} accessible style={styles.chip} testID={`${testID}-more`}>
          <Text allowFontScaling={false} style={styles.count}>+{hiddenKinds}</Text>
        </View>
      ) : null}
      <Pressable
        accessibilityLabel={t('reactions.add')}
        accessibilityRole="button"
        hitSlop={{ bottom: 10, left: 6, right: 6, top: 10 }}
        onPress={onAdd}
        style={styles.chip}
        testID={`${testID}-add`}
      >
        <SmileyPlusIcon color={colors.textSecondary} size={14} strokeWidth={1.9} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  // Wraps rather than clips: a long row on a narrow screen goes to a second line.
  row: { alignItems: 'center', columnGap: spacing.xs, flexDirection: 'row', flexWrap: 'wrap', marginTop: 6, rowGap: spacing.xs },
  chip: {
    alignItems: 'center',
    backgroundColor: colors.surfaceMuted,
    borderColor: 'transparent',
    borderRadius: radii.lg,
    borderWidth: 1,
    columnGap: 3,
    flexDirection: 'row',
    height: 24,
    justifyContent: 'center',
    minWidth: 28,
    paddingHorizontal: 7,
  },
  // The caller's own: a ring and a faint tint, not a filled button.
  chipMine: { backgroundColor: colors.brandSoft, borderColor: colors.brand },
  emoji: { fontSize: 13 },
  count: { color: colors.textSecondary, fontSize: 12, fontWeight: '700' },
  countMine: { color: colors.brand },
});
