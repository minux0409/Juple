import { StyleSheet, Text, View } from 'react-native';
import { colors, spacing } from '../theme/tokens';

interface CenteredEmptyStateProps {
  readonly message: string;
}

/**
 * Juple's shared "이 화면의 목록이 비어 있음" presentation - a `ListEmptyComponent` sibling to a
 * FlatList/SectionList's own `ListHeaderComponent`, inside the same `flexGrow:1`
 * contentContainerStyle: this component's own `flex:1` then claims exactly the remaining space
 * below the header (input/settings/header rows stay right where they are), centering the message
 * both horizontally and vertically within it - never the whole screen, never absolute positioning.
 * Text only, reusing the existing empty-state typography/color - no card, illustration, or icon.
 */
export function CenteredEmptyState({ message }: CenteredEmptyStateProps) {
  return (
    <View style={styles.container}>
      <Text style={styles.text}>{message}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'center',
    paddingVertical: spacing.xl,
  },
  text: {
    color: colors.textSecondary,
    fontSize: 14,
    textAlign: 'center',
  },
});
