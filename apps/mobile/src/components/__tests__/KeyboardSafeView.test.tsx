import ReactTestRenderer, { act } from 'react-test-renderer';
import { KeyboardAvoidingView, StyleSheet, Text, TextInput, View } from 'react-native';
import { KeyboardSafeView } from '../KeyboardSafeView';

/**
 * Structure only: Jest cannot show a keyboard. What this proves is the pattern every TextInput holder uses
 * (see the round's device checklist for the real behavior on Samsung Android 16 and Android 8.1).
 */
describe('KeyboardSafeView', () => {
  const render = (element: React.ReactElement) => {
    let renderer!: ReactTestRenderer.ReactTestRenderer;
    act(() => {
      renderer = ReactTestRenderer.create(element);
    });
    return renderer;
  };

  it('avoids the keyboard with padding (works on every Android API level, API 27 included, and on iOS)', () => {
    const renderer = render(<KeyboardSafeView><TextInput /></KeyboardSafeView>);

    const avoiding = renderer.root.findByType(KeyboardAvoidingView);
    expect(avoiding.props.behavior).toBe('padding');
    expect(avoiding.props.enabled).toBe(true);
    expect(StyleSheet.flatten(avoiding.props.style)).toMatchObject({ flex: 1 });
    expect(renderer.root.findAllByType(TextInput)).toHaveLength(1);
  });

  it('keeps the container\'s own style (padding, alignment) on an inner view, because the padding avoidance replaces the outer view\'s bottom padding', () => {
    const renderer = render(
      <KeyboardSafeView style={{ backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'center', paddingBottom: 34, paddingTop: 24 }} testID="frame">
        <Text>content</Text>
      </KeyboardSafeView>,
    );

    const outer = StyleSheet.flatten(renderer.root.findByType(KeyboardAvoidingView).props.style);
    expect(outer.backgroundColor).toBe('rgba(0,0,0,0.4)');
    expect(outer.paddingBottom).toBeUndefined();
    const innerHost = renderer.root.findAll(node => typeof node.type === 'string' && node.props.testID === 'frame')[0];
    const inner = StyleSheet.flatten(innerHost.props.style);
    expect(inner).toMatchObject({ flex: 1, justifyContent: 'center', paddingBottom: 34, paddingTop: 24 });
    expect(inner.backgroundColor).toBeUndefined();
  });

  it('can be switched off while nothing takes input (a plain view then)', () => {
    const renderer = render(<KeyboardSafeView enabled={false}><View /></KeyboardSafeView>);

    expect(renderer.root.findByType(KeyboardAvoidingView).props.enabled).toBe(false);
  });
});
