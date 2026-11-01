import { StyleSheet, View } from 'react-native';
import { colors } from '../theme/tokens';

/**
 * The "it is being pressed" layer for ONE part of a larger control - the icon tile inside a grid cell, the pencil inside a row - instead of
 * the whole control. Use it with the app Pressable's `pressFeedback={false}` and a children function, so the whole cell / row keeps its full
 * touch area and its single onPress, while only this shape (the icon's own size and corner radius) shows the press:
 *
 *   <Pressable pressFeedback={false} ...>{({ pressed }) => <><View style={iconSlot}><Icon /><PressedShape borderRadius={r} pressed={pressed} /></View><Text /></>}</Pressable>
 *
 * It fills its parent (the parent must be exactly the icon's box, e.g. a relative-positioned icon slot), never changes layout, never takes
 * touches, and is drawn only while held. Same colours as the app Pressable's own layer (a round `strong` one for an icon-only button).
 * A row or card that is meant to be pressed as a whole keeps the Pressable's default layer - do not use this there.
 */
export function PressedShape({
  pressed,
  borderRadius,
  strong = false,
  testID = 'press-feedback-shape',
}: {
  readonly pressed: boolean;
  readonly borderRadius: number;
  /** The stronger layer an icon-only button gets (default: the lighter layer of a tile). */
  readonly strong?: boolean;
  readonly testID?: string;
}) {
  if (!pressed) {
    return null;
  }
  return (
    <View
      pointerEvents="none"
      style={[StyleSheet.absoluteFill, { backgroundColor: strong ? colors.pressedOverlayStrong : colors.pressedOverlay, borderRadius }]}
      testID={testID}
    />
  );
}
