import ReactTestRenderer, { act } from 'react-test-renderer';
import { StyleSheet, Text } from 'react-native';
import { GradientPill } from '../GradientPill';

describe('GradientPill', () => {
  it('draws its gradient at the measured size of the pill (never a percentage-sized SVG), with a solid fallback before that', () => {
    let renderer!: ReactTestRenderer.ReactTestRenderer;
    act(() => {
      renderer = ReactTestRenderer.create(<GradientPill label="D-18" testID="pill" />);
    });
    const pill = renderer.root.findAll(node => node.props.testID === 'pill' && typeof node.props.onLayout === 'function')[0];
    expect(StyleSheet.flatten(pill.props.style).backgroundColor).toBeDefined();
    expect(renderer.root.findAll(node => node.props.rx !== undefined)).toHaveLength(0);

    act(() => pill.props.onLayout({ nativeEvent: { layout: { x: 0, y: 0, width: 52, height: 22 } } }));

    const rect = renderer.root.findAll(node => node.props.rx !== undefined)[0];
    expect(rect.props).toMatchObject({ width: 52, height: 22, rx: 11 });
    expect(renderer.root.findAllByType(Text).map(node => node.props.children)).toEqual(['D-18']);
  });
});
