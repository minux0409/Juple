import { Pressable, StyleSheet, Text, View } from 'react-native';
import { ChevronIcon } from '../icons/ChevronIcon';
import { colors, minTouchTarget, spacing } from '../theme/tokens';

interface FaqAccordionItemProps {
  readonly question: string;
  readonly answer: string;
  readonly isExpanded: boolean;
  readonly onToggle: () => void;
  readonly testID?: string;
}

/**
 * One FAQ row: the question, a chevron, and - while open - the answer right below it, inside the same screen
 * (no modal), so the scroll position never moves. The expanded state is exposed to screen readers.
 */
export function FaqAccordionItem({ question, answer, isExpanded, onToggle, testID }: FaqAccordionItemProps) {
  return (
    <View>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: isExpanded }}
        onPress={onToggle}
        style={styles.question}
        testID={testID}
      >
        <Text style={styles.questionText}>{question}</Text>
        <ChevronIcon color={colors.textSecondary} direction={isExpanded ? 'up' : 'down'} size={18} />
      </Pressable>
      {isExpanded ? <Text style={styles.answer} testID={testID ? `${testID}-answer` : undefined}>{answer}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  question: { alignItems: 'center', columnGap: spacing.sm, flexDirection: 'row', minHeight: minTouchTarget, paddingHorizontal: spacing.md, paddingVertical: spacing.sm + 2 },
  questionText: { color: colors.textPrimary, flex: 1, fontSize: 15, fontWeight: '600' },
  answer: { color: colors.textSecondary, fontSize: 14, lineHeight: 21, paddingBottom: spacing.md, paddingHorizontal: spacing.md },
});
