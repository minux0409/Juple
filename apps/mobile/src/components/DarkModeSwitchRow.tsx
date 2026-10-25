import { useTranslation } from 'react-i18next';
import { Text, View, type StyleProp, type TextStyle, type ViewProps, type ViewStyle } from 'react-native';
import { MoonIcon } from '../icons/MoonIcon';
import { useTheme } from '../theme/ThemeContext';
import { colors } from '../theme/tokens';
import { ThemedSwitch } from './ThemedSwitch';

/**
 * 다크 모드: ONE on/off row (내 페이지), no screen of its own. On = explicit Dark, Off = explicit Light. A device that still stores the
 * old 시스템 설정 사용 shows the theme the system currently resolves to (the stored value is left alone until the switch is first
 * used), and from then on the choice is an explicit light/dark. Applies at once (the whole app and the OS chrome follow), stays across
 * restarts, sign-out and account changes (this device only, ThemeContext). Nothing is sent to the server.
 */
export function DarkModeSwitchRow({
  rowStyle,
  iconStyle,
  labelStyle,
  ...rowProps
}: ViewProps & { readonly rowStyle: StyleProp<ViewStyle>; readonly iconStyle: StyleProp<ViewStyle>; readonly labelStyle: StyleProp<TextStyle> }) {
  const { t } = useTranslation();
  const { isDark, setPreference } = useTheme();
  return (
    <View {...rowProps} style={rowStyle}>
      <View style={iconStyle}>
        <MoonIcon color={colors.textSecondary} size={18} />
      </View>
      <Text style={labelStyle}>{t('appearance.darkMode')}</Text>
      <ThemedSwitch
        accessibilityLabel={t('appearance.darkMode')}
        accessibilityRole="switch"
        accessibilityState={{ checked: isDark }}
        onValueChange={next => setPreference(next ? 'dark' : 'light')}
        testID="appearance-dark-mode-switch"
        value={isDark}
      />
    </View>
  );
}
