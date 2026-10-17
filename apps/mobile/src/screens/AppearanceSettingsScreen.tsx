import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { THEME_PREFERENCES, useTheme, type ThemePreference } from '../theme/ThemeContext';
import { colors, themedStyles } from '../theme/tokens';

const LABEL_KEYS: Readonly<Record<ThemePreference, string>> = {
  system: 'appearance.system',
  light: 'appearance.light',
  dark: 'appearance.dark',
};

/**
 * 화면 모드: 시스템 설정 사용 / 라이트 / 다크, the same list as 언어. The choice is this device's, applies at once (the whole app
 * and the OS chrome follow) and stays across restarts, sign-out and account changes. Nothing is sent to the server.
 */
export function AppearanceSettingsScreen() {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const { preference, setPreference } = useTheme();
  return (
    <View style={styles.safeArea}>
      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: 24 + insets.bottom }]}>
        {THEME_PREFERENCES.map(option => {
          const isSelected = preference === option;
          return (
            <Pressable
              accessibilityRole="radio"
              accessibilityState={{ checked: isSelected, selected: isSelected }}
              key={option}
              onPress={() => {
                if (!isSelected) {
                  setPreference(option);
                }
              }}
              style={styles.row}
              testID={`appearance-${option}`}
            >
              <Text style={styles.label}>{t(LABEL_KEYS[option])}</Text>
              {isSelected ? <Text style={styles.checkmark}>✓</Text> : null}
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

const styles = themedStyles(() => ({
  safeArea: { backgroundColor: colors.background, flex: 1 },
  content: { padding: 24 },
  row: {
    alignItems: 'center',
    borderBottomColor: colors.divider,
    borderBottomWidth: 1,
    flexDirection: 'row',
    minHeight: 56,
    paddingVertical: 16,
  },
  label: { color: colors.textPrimary, flex: 1, fontSize: 16 },
  checkmark: { color: colors.brand, fontSize: 18, fontWeight: '700' },
}));
