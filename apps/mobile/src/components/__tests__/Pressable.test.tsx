import type { ReactNode } from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';
import { StyleSheet, Text, View, type PressableProps } from 'react-native';
import { colors } from '../../theme/tokens';

// Every other test sees React Native's own Pressable (jest.setup.js); this one tests the app's wrapper itself.
const { Pressable } = jest.requireActual<typeof import('../Pressable')>('../Pressable');

const Icon = () => <View />;

function render(props: PressableProps & { pressFeedback?: boolean }, children: ReactNode = <Text>OK</Text>) {
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  act(() => {
    renderer = ReactTestRenderer.create(
      <Pressable testID="target" {...props}>
        {children}
      </Pressable>,
    );
  });
  // React Native's Pressable inside the wrapper: the second node carrying the testID.
  const inner = renderer.root.findAll(node => node.props.testID === 'target')[1];
  return { inner };
}

/** What the control draws while held (or not): its children, rendered for that state, in a throwaway tree. */
function drawn(inner: ReactTestRenderer.ReactTestInstance, pressed: boolean) {
  const children = typeof inner.props.children === 'function' ? inner.props.children({ pressed, hovered: false }) : inner.props.children;
  let tree!: ReactTestRenderer.ReactTestRenderer;
  act(() => {
    tree = ReactTestRenderer.create(<View>{children}</View>);
  });
  return tree.root;
}
const layerOf = (root: ReactTestRenderer.ReactTestInstance) => root.findAll(node => node.props.testID === 'press-feedback-layer' && typeof node.type === 'string')[0];
const circleOf = (root: ReactTestRenderer.ReactTestInstance) => root.findAll(node => node.props.testID === 'press-feedback-circle' && typeof node.type === 'string')[0];

function laidOut(inner: ReactTestRenderer.ReactTestInstance, width: number, height: number) {
  act(() => inner.props.onLayout({ nativeEvent: { layout: { x: 0, y: 0, width, height } } }));
}

describe('the app Pressable - a press feedback only while a control is held', () => {
  it('a text button gets a state layer in its own shape while held - its own style, size and layout untouched; gone when released', () => {
    const style = { height: 44, paddingHorizontal: 12, borderRadius: 10 };
    const { inner } = render({ accessibilityRole: 'button', onPress: jest.fn(), style });
    laidOut(inner, 120, 44);
    expect(inner.props.style).toBe(style);
    expect(layerOf(drawn(inner, false))).toBeUndefined();

    const layer = layerOf(drawn(inner, true));
    expect(StyleSheet.flatten(layer.props.style)).toMatchObject({ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, borderRadius: 10, backgroundColor: colors.pressedOverlay });
    expect(layer.props.pointerEvents).toBe('none');
    expect(circleOf(drawn(inner, true))).toBeUndefined();
  });

  it('a filled button gets the stronger layer, so the press still shows on its colour', () => {
    const { inner } = render({ accessibilityRole: 'button', onPress: jest.fn(), style: { backgroundColor: '#123456', borderRadius: 8 } });
    laidOut(inner, 200, 48);
    expect(StyleSheet.flatten(layerOf(drawn(inner, true)).props.style).backgroundColor).toBe(colors.pressedOverlayStrong);
  });

  it('an icon-only button gets a round background inside its own bounds', () => {
    const { inner } = render({ accessibilityRole: 'button', accessibilityLabel: '검색', onPress: jest.fn(), style: { minHeight: 44, minWidth: 44 } }, <Icon />);
    laidOut(inner, 44, 44);
    const root = drawn(inner, true);
    expect(layerOf(root)).toBeUndefined();
    const circle = circleOf(root).findAll(node => typeof node.type === 'string' && StyleSheet.flatten(node.props.style)?.backgroundColor === colors.pressedOverlayStrong)[0];
    expect(StyleSheet.flatten(circle.props.style)).toMatchObject({ width: 44, height: 44, borderRadius: 22 });
    expect(circleOf(root).props.pointerEvents).toBe('none');
  });

  it('a wide row or card without words of its own is not a circle - it gets the row-shaped layer', () => {
    const { inner } = render({ accessibilityRole: 'button', onPress: jest.fn(), style: { borderRadius: 12 } }, <Icon />);
    laidOut(inner, 360, 72);
    expect(circleOf(drawn(inner, true))).toBeUndefined();
    expect(StyleSheet.flatten(layerOf(drawn(inner, true)).props.style).borderRadius).toBe(12);
  });

  it('a small square button with a word is a text button, not an icon button', () => {
    const { inner } = render({ accessibilityRole: 'button', onPress: jest.fn() }, <View><Text>OK</Text></View>);
    laidOut(inner, 44, 44);
    expect(circleOf(drawn(inner, true))).toBeUndefined();
    expect(layerOf(drawn(inner, true))).toBeDefined();
  });

  it.each(['link', 'tab', 'radio', 'checkbox', 'switch', 'menuitem'] as const)('a %s control shows it too', role => {
    const { inner } = render({ accessibilityRole: role, onPress: jest.fn(), style: { padding: 4 } });
    expect(layerOf(drawn(inner, true))).toBeDefined();
  });

  it('the ARIA-style role (the tab bar passes `role`) counts the same', () => {
    const { inner } = render({ role: 'tab', onPress: jest.fn() });
    expect(layerOf(drawn(inner, true))).toBeDefined();
  });

  it('a backdrop or touch-blocking wrapper (no control role, or nothing to press) never shows a press', () => {
    expect(typeof render({ onPress: jest.fn(), style: { flex: 1 } }).inner.props.children).not.toBe('function');
    expect(typeof render({ accessibilityRole: 'button', style: { flex: 1 } }).inner.props.children).not.toBe('function');
  });

  it('a disabled control shows nothing', () => {
    expect(typeof render({ accessibilityRole: 'button', disabled: true, onPress: jest.fn() }).inner.props.children).not.toBe('function');
  });

  it('a control that designs its own pressed look keeps exactly that', () => {
    const own = ({ pressed }: { pressed: boolean }) => ({ backgroundColor: pressed ? '#EEEEEE' : '#FFFFFF' });
    const { inner } = render({ accessibilityRole: 'button', onPress: jest.fn(), style: own });
    expect(inner.props.style).toBe(own);
    expect(typeof inner.props.children).not.toBe('function');
  });

  it('pressFeedback opts a control in or out explicitly', () => {
    expect(typeof render({ accessibilityRole: 'button', onPress: jest.fn(), pressFeedback: false }).inner.props.children).not.toBe('function');
    expect(layerOf(drawn(render({ onLongPress: jest.fn(), pressFeedback: true }).inner, true))).toBeDefined();
  });

  it('a caller\'s own onLayout and children-function still work', () => {
    const onLayout = jest.fn();
    const { inner } = render({ accessibilityRole: 'button', onLayout, onPress: jest.fn() }, undefined);
    laidOut(inner, 10, 10);
    expect(onLayout).toHaveBeenCalledTimes(1);

    let tree!: ReactTestRenderer.ReactTestRenderer;
    act(() => {
      tree = ReactTestRenderer.create(
        <Pressable accessibilityRole="button" onPress={jest.fn()} testID="fn">
          {({ pressed }) => <Text>{pressed ? 'down' : 'up'}</Text>}
        </Pressable>,
      );
    });
    const fnInner = tree.root.findAll(node => node.props.testID === 'fn')[1];
    expect(drawn(fnInner, true).findAllByType(Text).map(node => node.props.children)).toEqual(['down']);
  });

  it('passes everything else through unchanged', () => {
    const onPress = jest.fn();
    const { inner } = render({ accessibilityRole: 'button', accessibilityLabel: '저장', disabled: true, hitSlop: 8, onPress });
    expect(inner.props).toEqual(expect.objectContaining({ accessibilityRole: 'button', accessibilityLabel: '저장', disabled: true, hitSlop: 8, onPress }));
  });
});
