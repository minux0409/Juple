import { StyleSheet, Switch, type SwitchProps } from 'react-native';
import { useTheme } from '../theme/ThemeContext';
import { colors } from '../theme/tokens';

const styles = StyleSheet.create({ disabled: { opacity: 0.5 } });

/**
 * The one Switch of the app. Light keeps the platform's own look. In Dark the native OFF state (a dark-grey track on a dark card) is
 * barely visible, so OFF gets a clearly lighter track and a bright thumb from the theme roles (`border` / `textPrimary`); ON keeps
 * the platform accent. A disabled switch is dimmed so it never reads as simply "off". Behaviour is the plain Switch's.
 */
export function ThemedSwitch({ disabled, style, ...rest }: SwitchProps) {
  const { isDark } = useTheme();
  const combined = [style, disabled ? styles.disabled : null];
  if (!isDark) {
    return <Switch disabled={disabled} style={combined} {...rest} />;
  }
  return (
    <Switch
      disabled={disabled}
      ios_backgroundColor={colors.border}
      style={combined}
      thumbColor={rest.value ? undefined : colors.textPrimary}
      trackColor={{ false: colors.border, true: undefined }}
      {...rest}
    />
  );
}
