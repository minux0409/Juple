import { useEffect, useRef } from 'react';
import { Animated, Platform, StyleSheet, Switch, View, type SwitchProps } from 'react-native';
import { Pressable } from './Pressable';
import { useTheme } from '../theme/ThemeContext';
import { colors, minTouchTarget } from '../theme/tokens';

const styles = StyleSheet.create({ disabled: { opacity: 0.5 } });

/**
 * The one Switch of the app.
 *
 * Android: the platform's own switch (AppCompat / Material). Light keeps the platform's own look. In Dark the native OFF state (a
 * dark-grey track on a dark card) is barely visible, so OFF gets a clearly lighter track and a bright thumb from the theme roles
 * (`border` / `textPrimary`); ON keeps the platform accent. A disabled switch is dimmed so it never reads as simply "off".
 *
 * iOS: the native UISwitch (51x31, iOS 26 style) is much larger and heavier than Android's, so iOS draws the same Material switch
 * Android shows instead - its proportions and its colors - as an accessible switch with a 44pt target (MaterialSwitch below).
 */
export function ThemedSwitch(props: SwitchProps) {
  const { isDark } = useTheme();
  if (Platform.OS === 'ios') {
    return <MaterialSwitch {...props} isDark={isDark} />;
  }
  const { disabled, style, ...rest } = props;
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

// Android's AppCompat switch, which this app does not restyle (no colorAccent in its theme): a 20dp thumb over a 34x14dp track,
// ON = the AppCompat accent (Material deep teal 500 light / 200 dark) with its track at 30%, OFF = a light thumb over a 30%
// foreground track. Dark OFF uses ThemedSwitch's own Android overrides (textPrimary thumb, border track).
const THUMB = 20;
const TRACK_WIDTH = 34;
const TRACK_HEIGHT = 14;
const TRAVEL = TRACK_WIDTH - THUMB + 2;
const ACCENT = { light: '#009688', dark: '#80CBC4' } as const;
const ACCENT_TRACK = { light: 'rgba(0, 150, 136, 0.3)', dark: 'rgba(128, 203, 196, 0.3)' } as const;
const OFF_THUMB_LIGHT = '#F1F1F1';
const OFF_TRACK_LIGHT = 'rgba(0, 0, 0, 0.3)';

export const MATERIAL_SWITCH_COLORS = { ACCENT, ACCENT_TRACK, OFF_THUMB_LIGHT, OFF_TRACK_LIGHT } as const;

function MaterialSwitch({
  value = false,
  onValueChange,
  disabled,
  style,
  isDark,
  testID,
  accessibilityLabel,
  accessibilityRole,
  accessibilityState,
}: SwitchProps & { readonly isDark: boolean }) {
  const position = useRef(new Animated.Value(value ? 1 : 0)).current;
  useEffect(() => {
    Animated.timing(position, { duration: 120, toValue: value ? 1 : 0, useNativeDriver: true }).start();
  }, [position, value]);

  const scheme = isDark ? 'dark' : 'light';
  const thumbColor = value ? ACCENT[scheme] : isDark ? colors.textPrimary : OFF_THUMB_LIGHT;
  const trackColor = value ? ACCENT_TRACK[scheme] : isDark ? colors.border : OFF_TRACK_LIGHT;
  const translateX = position.interpolate({ inputRange: [0, 1], outputRange: [0, TRAVEL] });

  return (
    <Pressable
      accessibilityLabel={accessibilityLabel}
      accessibilityRole={accessibilityRole ?? 'switch'}
      accessibilityState={accessibilityState ?? { checked: value, disabled: disabled === true }}
      disabled={disabled || !onValueChange}
      onPress={() => onValueChange?.(!value)}
      style={[materialStyles.target, style, disabled ? styles.disabled : null]}
      testID={testID}
    >
      <View style={materialStyles.body}>
        <View style={[materialStyles.track, { backgroundColor: trackColor }]} />
        <Animated.View style={[materialStyles.thumb, { backgroundColor: thumbColor, transform: [{ translateX }] }]} testID="material-switch-thumb" />
      </View>
    </Pressable>
  );
}

const materialStyles = StyleSheet.create({
  target: { alignItems: 'center', justifyContent: 'center', minHeight: minTouchTarget, minWidth: minTouchTarget },
  body: { height: THUMB, justifyContent: 'center', width: TRAVEL + THUMB },
  track: { alignSelf: 'center', borderRadius: TRACK_HEIGHT / 2, height: TRACK_HEIGHT, width: TRACK_WIDTH },
  thumb: {
    borderRadius: THUMB / 2,
    height: THUMB,
    left: 0,
    position: 'absolute',
    shadowColor: '#000',
    shadowOffset: { height: 1, width: 0 },
    shadowOpacity: 0.3,
    shadowRadius: 1.5,
    top: 0,
    width: THUMB,
  },
});
