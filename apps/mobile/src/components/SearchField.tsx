import { Pressable, StyleSheet, TextInput, View } from 'react-native';
import { CloseIcon } from '../icons/CloseIcon';
import { SearchIcon } from '../icons/SearchIcon';
import { colors, minTouchTarget, radii, spacing } from '../theme/tokens';

interface SearchFieldProps {
  readonly value: string;
  readonly onChangeText: (text: string) => void;
  readonly placeholder: string;
  /** Accessibility label of the clear button (shown only while there is text). */
  readonly clearLabel: string;
  readonly testID?: string;
}

/** A single-line search box with a clear button - the Archive's (and any list's) text filter field. */
export function SearchField({ value, onChangeText, placeholder, clearLabel, testID = 'search-field' }: SearchFieldProps) {
  return (
    <View style={styles.wrapper}>
      {/* The magnifier is part of the field, not a control: it takes no touches of its own (a tap there
          reaches the input) and is not announced - the field's own label says what it is. */}
      <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" pointerEvents="none" style={styles.searchIcon} testID={`${testID}-icon`}>
        <SearchIcon color={colors.textSecondary} size={18} />
      </View>
      <TextInput
        accessibilityLabel={placeholder}
        autoCapitalize="none"
        autoCorrect={false}
        clearButtonMode="never"
        onChangeText={onChangeText}
        placeholder={placeholder}
        returnKeyType="search"
        style={styles.input}
        testID={testID}
        value={value}
      />
      {value.length > 0 ? (
        <Pressable accessibilityLabel={clearLabel} accessibilityRole="button" hitSlop={4} onPress={() => onChangeText('')} style={styles.clear} testID={`${testID}-clear`}>
          <CloseIcon color={colors.textSecondary} size={18} />
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: { justifyContent: 'center' },
  input: {
    backgroundColor: colors.surface,
    borderColor: colors.inputBorder,
    borderRadius: radii.md + 4,
    borderWidth: 1,
    color: colors.textPrimary,
    fontSize: 16,
    minHeight: minTouchTarget,
    paddingEnd: minTouchTarget,
    paddingStart: spacing.md + 18 + spacing.sm,
  },
  searchIcon: { alignItems: 'center', bottom: 0, justifyContent: 'center', position: 'absolute', start: spacing.md, top: 0, zIndex: 1 },
  clear: { alignItems: 'center', bottom: 0, end: 0, height: minTouchTarget, justifyContent: 'center', position: 'absolute', top: 0, width: minTouchTarget },
});
