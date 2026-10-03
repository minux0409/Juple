import { useRef, useState, type ComponentRef, type ReactNode } from 'react';
import {
  KeyboardAvoidingView,
  StyleSheet,
  View,
  type LayoutChangeEvent,
  type StyleProp,
  type ViewProps,
  type ViewStyle,
} from 'react-native';

interface KeyboardSafeViewProps extends Pick<ViewProps, 'pointerEvents' | 'testID'> {
  /**
   * Exactly the style the container had before (flex, padding, alignment, ...). Its background goes on
   * the outer view so a dim backdrop keeps covering the area the keyboard opens over; everything else
   * stays on the inner view, so its own padding (e.g. safe-area insets) is never overwritten.
   */
  readonly style?: StyleProp<ViewStyle>;
  readonly children: ReactNode;
  /** Set to false while nothing in here takes text input (the container then behaves as a plain view). */
  readonly enabled?: boolean;
}

/**
 * Juple's one keyboard-avoidance pattern: whatever sits in here ends up above the on-screen keyboard
 * (a focused input, what is typed, and the action under it) - for a full screen, a centered dialog or a
 * bottom sheet alike. Use it for the container that holds a TextInput instead of a per-screen
 * KeyboardAvoidingView or hand-tuned bottom padding.
 *
 * - Android: the manifest's adjustResize does not resize an edge-to-edge window (Android 15+) or a
 *   Modal's dialog window, so the keyboard is avoided with padding from the keyboard event
 *   (`keyboardDidShow` - available on every API level, Android 8.1 included). Where the window DOES
 *   resize (older Android, no edge-to-edge) the view already ends above the keyboard, so the
 *   computed overlap is zero and nothing is doubled. No API newer than API 27 is used.
 * - iOS: the same padding from `keyboardWillChangeFrame`.
 * - React Native measures a KeyboardAvoidingView's position relative to its PARENT, not the window, so
 *   a view that does not start at the top of the window (below a stack header) would under-pad by the
 *   header's height; the view's own window offset is measured once laid out and passed as
 *   keyboardVerticalOffset, so no per-screen "header height" constant exists anywhere.
 * - KeyboardAvoidingView's padding replaces the container's own bottom padding while it is applied,
 *   which is why the container's style lives on an inner view.
 *
 * ScrollViews in here should keep keyboardShouldPersistTaps="handled" so the action button under a
 * focused input still takes the first tap. Final behavior needs a real device (see the round's report).
 */
export function KeyboardSafeView({ style, children, enabled = true, pointerEvents, testID }: KeyboardSafeViewProps) {
  const ref = useRef<ComponentRef<typeof View>>(null);
  const [verticalOffset, setVerticalOffset] = useState(0);
  const { backgroundColor, ...innerStyle } = StyleSheet.flatten(style) ?? {};

  const handleLayout = (event: LayoutChangeEvent) => {
    // The inner view starts exactly where the (bottom-padded) outer one does, so its window position is the outer's.
    const layoutY = event.nativeEvent.layout.y;
    ref.current?.measureInWindow((_x, windowY) => {
      // Only the part of the window offset that the parent-relative frame does not already include.
      const next = Math.max(Math.round((windowY ?? 0) - layoutY), 0);
      setVerticalOffset(previous => (previous === next ? previous : next));
    });
  };

  return (
    <KeyboardAvoidingView
      behavior="padding"
      enabled={enabled}
      keyboardVerticalOffset={verticalOffset}
      onLayout={handleLayout}
      pointerEvents={pointerEvents}
      style={[styles.outer, backgroundColor !== undefined && { backgroundColor }]}
      testID={testID ? `${testID}-keyboard-safe` : undefined}
    >
      <View pointerEvents={pointerEvents} ref={ref} style={[styles.inner, innerStyle]} testID={testID}>
        {children}
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  outer: { flex: 1 },
  inner: { flex: 1 },
});
