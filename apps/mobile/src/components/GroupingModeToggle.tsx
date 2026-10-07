import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { BrowsingGroupingMode } from '../settings/groupingModePreference';
import { colors, radii, spacing } from '../theme/tokens';

interface GroupingModeToggleProps {
  readonly value: BrowsingGroupingMode;
  readonly onChange: (value: BrowsingGroupingMode) => void;
  readonly testID?: string;
}

/**
 * 날짜별 | 전체 - whether links sit under date headers or run on continuously. A text pill (not a
 * glyph pair) so it never reads as part of the List/Grid switch beside it; it shrinks and ellipsizes
 * on a long translation, and each half keeps a 44dp touch target (32 + 6 hit slop each side).
 */
export function GroupingModeToggle({ value, onChange, testID }: GroupingModeToggleProps) {
  const { t } = useTranslation();
  const options: readonly { readonly mode: BrowsingGroupingMode; readonly label: string }[] = [
    { mode: 'grouped', label: t('history.groupByDate') },
    { mode: 'continuous', label: t('history.groupAll') },
  ];
  return (
    <View accessibilityLabel={t('history.groupingA11y')} accessibilityRole="radiogroup" style={styles.container} testID={testID}>
      {options.map(option => (
        <Pressable
          accessibilityLabel={option.label}
          accessibilityRole="radio"
          accessibilityState={{ selected: value === option.mode }}
          hitSlop={{ bottom: 6, top: 6 }}
          key={option.mode}
          onPress={() => onChange(option.mode)}
          style={[styles.button, value === option.mode && styles.buttonSelected]}
          testID={testID ? `${testID}-${option.mode}` : undefined}
        >
          <Text numberOfLines={1} style={[styles.label, value === option.mode && styles.labelSelected]}>{option.label}</Text>
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { backgroundColor: colors.surfaceMuted, borderRadius: radii.md, flexDirection: 'row', flexShrink: 1, minWidth: 0, padding: 2 },
  button: { alignItems: 'center', borderRadius: radii.sm, flexShrink: 1, height: 32, justifyContent: 'center', minWidth: 0, paddingHorizontal: spacing.md },
  buttonSelected: { backgroundColor: colors.surface },
  label: { color: colors.textSecondary, fontSize: 13, fontWeight: '600' },
  labelSelected: { color: colors.brand, fontWeight: '700' },
});
