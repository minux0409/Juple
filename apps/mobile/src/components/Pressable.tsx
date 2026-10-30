import { Children, forwardRef, isValidElement, useCallback, useRef, type ComponentRef, type ReactNode } from 'react';
import {
  Pressable as NativePressable,
  StyleSheet,
  Text,
  View,
  type LayoutChangeEvent,
  type PressableProps,
  type PressableStateCallbackType,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { colors } from '../theme/tokens';

/** The roles of controls a person presses on purpose - they show the press; plain containers and backdrops never do. */
const PRESS_FEEDBACK_ROLES: ReadonlySet<string> = new Set(['button', 'link', 'tab', 'radio', 'checkbox', 'switch', 'menuitem', 'togglebutton']);

/** An icon-only control at most this large (pt) and about square gets the round pressed background. */
const ICON_BUTTON_MAX_SIZE = 64;
const ICON_BUTTON_SQUARE_TOLERANCE = 8;
/** How deep the children are searched for text when deciding whether a control is icon-only. */
const TEXT_SEARCH_DEPTH = 6;

const RADIUS_KEYS = [
  'borderRadius',
  'borderTopLeftRadius',
  'borderTopRightRadius',
  'borderBottomLeftRadius',
  'borderBottomRightRadius',
  'borderTopStartRadius',
  'borderTopEndRadius',
  'borderBottomStartRadius',
  'borderBottomEndRadius',
] as const;

/** True when the element tree holds any visible words (a string, a number or a Text) - a label, not just an icon. */
function containsText(node: ReactNode, depth = 0): boolean {
  if (typeof node === 'string' || typeof node === 'number') {
    return String(node).trim().length > 0;
  }
  if (depth > TEXT_SEARCH_DEPTH) {
    return false;
  }
  return Children.toArray(node).some(child => {
    if (typeof child === 'string' || typeof child === 'number') {
      return String(child).trim().length > 0;
    }
    if (!isValidElement<{ children?: ReactNode }>(child)) {
      return false;
    }
    return child.type === Text || containsText(child.props.children, depth + 1);
  });
}

/**
 * The app's Pressable: React Native's own, plus the same clear "it is being pressed" feedback on every control, iOS and Android
 * alike (iOS Pressable shows nothing by itself; Juple uses no Android ripple anywhere, so nothing doubles up). While a control is
 * held a translucent state layer is drawn over it - inside its own bounds, never changing its size or layout - and it is gone the
 * moment the finger lifts:
 * - an icon-only control with no fill of its own (no words inside, about square, at most 64pt) gets a round layer, like a
 *   circle behind the icon;
 * - anything else (a filled button - icon-only or not -, a text button, a row, a card, a tab) gets a layer in its own shape (its
 *   corner radii), stronger on a filled button so it still shows on the colour. A control built into a larger rounded shape (a
 *   button inside a text field) gives itself that shape's corner radii so the layer follows it.
 * Applied only where it means something:
 * - to an interactive control (a button / link / tab / radio / checkbox / switch / menu item role) that has an onPress or
 *   onLongPress - so a backdrop, a sheet's touch-blocking wrapper or a plain container never shows a press;
 * - not when the caller styles its own pressed look (a style function) - that one stays exactly as designed;
 * - never on a disabled control (it cannot be pressed); a selected state stays its own, separate style.
 * Same props and ref as React Native's Pressable; `pressFeedback={false}` opts a control out.
 */
export const Pressable = forwardRef<ComponentRef<typeof NativePressable>, PressableProps & { readonly pressFeedback?: boolean }>(
  function AppPressable({ style, pressFeedback, children, onLayout, ...rest }, ref) {
    // `role` (the ARIA-style prop, e.g. the tab bar's buttons) counts the same as accessibilityRole.
    const role = rest.accessibilityRole ?? rest.role;
    const isControl = role !== undefined && PRESS_FEEDBACK_ROLES.has(role);
    const showsPress =
      (pressFeedback ?? isControl) &&
      (rest.onPress != null || rest.onLongPress != null) &&
      !rest.disabled &&
      typeof style !== 'function';
    // The measured size, kept in a ref: reading it while pressed needs no extra render of every button on screen.
    const size = useRef<{ width: number; height: number } | null>(null);
    const handleLayout = useCallback(
      (event: LayoutChangeEvent) => {
        size.current = { width: event.nativeEvent.layout.width, height: event.nativeEvent.layout.height };
        onLayout?.(event);
      },
      [onLayout],
    );

    if (!showsPress) {
      return <NativePressable ref={ref} onLayout={onLayout} style={style} {...rest}>{children}</NativePressable>;
    }

    const flatStyle = (StyleSheet.flatten(style as StyleProp<ViewStyle>) ?? {}) as ViewStyle;
    const renderChildren = (state: PressableStateCallbackType) => {
      const content = typeof children === 'function' ? children(state) : children;
      if (!state.pressed) {
        return content;
      }
      const measured = size.current;
      const isFilled = flatStyle.backgroundColor !== undefined && flatStyle.backgroundColor !== 'transparent';
      const isIconButton =
        !isFilled &&
        measured !== null &&
        Math.max(measured.width, measured.height) <= ICON_BUTTON_MAX_SIZE &&
        Math.abs(measured.width - measured.height) <= ICON_BUTTON_SQUARE_TOLERANCE &&
        !containsText(content);
      return (
        <>
          {content}
          {isIconButton ? (
            <View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.centered]} testID="press-feedback-circle">
              <View
                style={{
                  backgroundColor: colors.pressedOverlayStrong,
                  borderRadius: Math.min(measured.width, measured.height) / 2,
                  height: Math.min(measured.width, measured.height),
                  width: Math.min(measured.width, measured.height),
                }}
              />
            </View>
          ) : (
            <View
              pointerEvents="none"
              style={[
                StyleSheet.absoluteFill,
                Object.fromEntries(RADIUS_KEYS.filter(key => flatStyle[key] !== undefined).map(key => [key, flatStyle[key]])),
                { backgroundColor: isFilled ? colors.pressedOverlayStrong : colors.pressedOverlay },
              ]}
              testID="press-feedback-layer"
            />
          )}
        </>
      );
    };
    return (
      <NativePressable ref={ref} onLayout={handleLayout} style={style} {...rest}>
        {renderChildren}
      </NativePressable>
    );
  },
);

const styles = StyleSheet.create({ centered: { alignItems: 'center', justifyContent: 'center' } });
