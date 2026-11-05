import { StyleSheet, Text } from 'react-native';
import ReactTestRenderer, { act } from 'react-test-renderer';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { TabScreenSafeArea } from '../TabScreenSafeArea';

const metrics = { frame: { x: 0, y: 0, width: 400, height: 800 }, insets: { top: 47, left: 0, right: 0, bottom: 34 } };

function render(style: object) {
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  act(() => {
    renderer = ReactTestRenderer.create(
      <SafeAreaProvider initialMetrics={metrics}>
        <TabScreenSafeArea style={style} testID="root"><Text>content</Text></TabScreenSafeArea>
      </SafeAreaProvider>,
    );
  });
  return renderer.root.findAll(node => node.props.testID === 'root' && typeof node.type === 'string')[0];
}

describe('TabScreenSafeArea (the root of a bottom-tab screen)', () => {
  it('is below the status bar from its very first render - a plain view with the provider\'s inset, not a native view measuring itself later', () => {
    const root = render({ flex: 1 });
    expect(root.type).toBe('View');
    expect(StyleSheet.flatten(root.props.style).paddingTop).toBe(47);
  });

  it('only the top edge (the tab bar reserves the bottom), added to a paddingTop of its own', () => {
    const style = StyleSheet.flatten(render({ flex: 1, paddingTop: 8 }).props.style);
    expect(style.paddingTop).toBe(55);
    expect(style.paddingBottom).toBeUndefined();
  });
});
