import ReactTestRenderer, { act } from 'react-test-renderer';
import { StyleSheet, Text, type PressableProps } from 'react-native';

// Every other test sees React Native's own Pressable (jest.setup.js); this one tests the app's wrapper itself.
const { Pressable, PRESSED_OPACITY } = jest.requireActual<typeof import('../Pressable')>('../Pressable');

function render(props: PressableProps & { pressFeedback?: boolean }) {
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  act(() => {
    renderer = ReactTestRenderer.create(
      <Pressable testID="target" {...props}>
        <Text>OK</Text>
      </Pressable>,
    );
  });
  // React Native's Pressable inside the wrapper: the second node carrying the testID.
  const inner = renderer.root.findAll(node => node.props.testID === 'target')[1];
  return { inner };
}
const styleWhen = (inner: ReactTestRenderer.ReactTestInstance, pressed: boolean) =>
  StyleSheet.flatten(typeof inner.props.style === 'function' ? inner.props.style({ pressed }) : inner.props.style) ?? {};

describe('the app Pressable - a press feedback only while a button is held', () => {
  it('a button fades while held and is back to its own style when released - size and layout untouched', () => {
    const { inner } = render({ accessibilityRole: 'button', onPress: jest.fn(), style: { height: 44, paddingHorizontal: 12, backgroundColor: '#123456' } });
    expect(styleWhen(inner, false)).toEqual({ height: 44, paddingHorizontal: 12, backgroundColor: '#123456' });
    expect(styleWhen(inner, true)).toEqual({ height: 44, paddingHorizontal: 12, backgroundColor: '#123456', opacity: PRESSED_OPACITY });
  });

  it.each(['link', 'tab', 'radio', 'checkbox', 'switch', 'menuitem'] as const)('a %s control shows it too', role => {
    const { inner } = render({ accessibilityRole: role, onPress: jest.fn(), style: { padding: 4 } });
    expect(styleWhen(inner, true).opacity).toBe(PRESSED_OPACITY);
  });

  it('a backdrop or touch-blocking wrapper (no control role, or nothing to press) never dims what it holds', () => {
    expect(styleWhen(render({ onPress: jest.fn(), style: { flex: 1 } }).inner, true).opacity).toBeUndefined();
    expect(styleWhen(render({ accessibilityRole: 'button', style: { flex: 1 } }).inner, true).opacity).toBeUndefined();
  });

  it('a control that designs its own pressed look keeps exactly that', () => {
    const own = ({ pressed }: { pressed: boolean }) => ({ backgroundColor: pressed ? '#EEEEEE' : '#FFFFFF' });
    const { inner } = render({ accessibilityRole: 'button', onPress: jest.fn(), style: own });
    expect(inner.props.style).toBe(own);
  });

  it('pressFeedback opts a control in or out explicitly', () => {
    expect(styleWhen(render({ accessibilityRole: 'button', onPress: jest.fn(), pressFeedback: false, style: { padding: 4 } }).inner, true).opacity).toBeUndefined();
    expect(styleWhen(render({ onLongPress: jest.fn(), pressFeedback: true, style: { padding: 4 } }).inner, true).opacity).toBe(PRESSED_OPACITY);
  });

  it('passes everything else through unchanged', () => {
    const onPress = jest.fn();
    const { inner } = render({ accessibilityRole: 'button', accessibilityLabel: '저장', disabled: true, hitSlop: 8, onPress });
    expect(inner.props).toEqual(expect.objectContaining({ accessibilityRole: 'button', accessibilityLabel: '저장', disabled: true, hitSlop: 8, onPress }));
  });
});
