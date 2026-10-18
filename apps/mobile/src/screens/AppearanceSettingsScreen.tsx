import { useTranslation } from 'react-i18next';
import { ScrollView, Text, View } from 'react-native';
import { ThemedSwitch } from '../components/ThemedSwitch';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MoonIcon } from '../icons/MoonIcon';
import { useTheme } from '../theme/ThemeContext';
import { colors, themedStyles } from '../theme/tokens';

/**
 * 다크 모드: one On/Off row. On = explicit Dark, Off = explicit Light. A device that still stores the old 시스템 설정 사용 shows the
 * theme the system currently resolves to (the stored value is left alone until the switch is first used), and from then on the
 * choice is an explicit light/dark. Applies at once (the whole app and the OS chrome follow), stays across restarts, sign-out and
 * account changes. Nothing is sent to the server.
 */
export function AppearanceSettingsScreen() {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const { isDark, setPreference } = useTheme();
  return (
    <View style={styles.safeArea}>
      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: 24 + insets.bottom }]}>
        <View style={styles.row}>
          <View style={styles.icon}>
            <MoonIcon color={colors.textSecondary} size={20} />
          </View>
          <Text style={styles.label}>{t('appearance.darkMode')}</Text>
          <ThemedSwitch
            accessibilityLabel={t('appearance.darkMode')}
            accessibilityRole="switch"
            accessibilityState={{ checked: isDark }}
            onValueChange={next => setPreference(next ? 'dark' : 'light')}
            testID="appearance-dark-mode-switch"
            value={isDark}
          />
        </View>
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
    gap: 12,
    minHeight: 56,
    paddingVertical: 8,
  },
  icon: { alignItems: 'center', justifyContent: 'center', width: 24 },
  label: { color: colors.textPrimary, flex: 1, fontSize: 16 },
}));
