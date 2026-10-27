import { forwardRef, type ComponentRef } from 'react';
import { Pressable as NativePressable, StyleSheet, type PressableProps } from 'react-native';

/** The roles of controls a person presses on purpose - they show the press; plain containers and backdrops never do. */
const PRESS_FEEDBACK_ROLES: ReadonlySet<string> = new Set(['button', 'link', 'tab', 'radio', 'checkbox', 'switch', 'menuitem', 'togglebutton']);

/** How much a held control fades - only while the finger is on it, never changing its size or layout. */
export const PRESSED_OPACITY = 0.6;

/**
 * The app's Pressable: React Native's own, plus the same short "it is being pressed" feedback on every button, iOS and Android
 * alike (iOS Pressable shows nothing by itself; there is no Android ripple anywhere in Juple to clash with). While a control is held
 * it fades a little and comes back the moment it is released. Applied only where it means something:
 * - to an interactive control (a button / link / tab / radio / checkbox / switch / menu item role) that has an onPress or
 *   onLongPress - so a backdrop, a sheet's touch-blocking wrapper or a plain container never dims its content;
 * - not when the caller styles its own pressed look (a style function) - that one stays exactly as designed;
 * - never on a disabled control (it cannot be pressed); a selected state stays its own, separate style.
 * Same props and ref as React Native's Pressable; `pressFeedback={false}` opts a control out.
 */
export const Pressable = forwardRef<ComponentRef<typeof NativePressable>, PressableProps & { readonly pressFeedback?: boolean }>(
  function AppPressable({ style, pressFeedback, ...rest }, ref) {
    const isControl = rest.accessibilityRole !== undefined && PRESS_FEEDBACK_ROLES.has(rest.accessibilityRole);
    const showsPress = (pressFeedback ?? isControl) && (rest.onPress != null || rest.onLongPress != null) && typeof style !== 'function';
    if (!showsPress) {
      return <NativePressable ref={ref} style={style} {...rest} />;
    }
    return <NativePressable ref={ref} style={({ pressed }) => (pressed ? [style, styles.pressed] : style)} {...rest} />;
  },
);

const styles = StyleSheet.create({ pressed: { opacity: PRESSED_OPACITY } });
