import { AccessibilityInfo, Animated } from 'react-native';
import ReactTestRenderer, { act } from 'react-test-renderer';
import { JellyBrandMark } from '../JellyBrandMark';
import { JupleBrandMark } from '../JupleBrandMark';

afterEach(() => jest.restoreAllMocks());

async function render() {
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => {
    renderer = ReactTestRenderer.create(<JellyBrandMark size="medium" />);
  });
  return renderer;
}

describe('JellyBrandMark (the startup jelly bounce)', () => {
  it('draws the unchanged Juple lockup inside a transformed view - the artwork itself is never replaced', async () => {
    const renderer = await render();
    const mark = renderer.root.findByType(JupleBrandMark);
    expect(mark.props).toEqual(expect.objectContaining({ size: 'medium' }));
    expect(mark.props.variant).toBeUndefined();
  });

  it('loops a squash -> stretch -> settle bounce on the native driver, and stops it when the screen goes away', async () => {
    const stop = jest.fn();
    const loop = jest.spyOn(Animated, 'loop').mockImplementation(() => ({ start: jest.fn(), stop, reset: jest.fn() }) as never);
    const timing = jest.spyOn(Animated, 'timing');
    const spring = jest.spyOn(Animated, 'spring');
    const renderer = await render();
    expect(loop).toHaveBeenCalledTimes(1);
    for (const [, config] of [...timing.mock.calls, ...spring.mock.calls]) {
      expect((config as { useNativeDriver: boolean }).useNativeDriver).toBe(true);
    }
    // Squash: shorter and wider; stretch: taller and narrower - never more than ~14% out of shape.
    const targets = timing.mock.calls.map(([, config]) => (config as { toValue: number }).toValue);
    expect(targets).toEqual(expect.arrayContaining([1.1, 0.86, 0.95, 1.06]));
    expect(targets.every(value => Math.abs(value) <= 10 || (value >= 0.86 && value <= 1.14))).toBe(true);
    // ...and back to its exact own shape.
    expect(spring.mock.calls.map(([, config]) => (config as { toValue: number }).toValue)).toEqual([1, 1, 0]);
    act(() => renderer.unmount());
    expect(stop).toHaveBeenCalled();
  });

  it('stands still with Reduce Motion', async () => {
    jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(true);
    const loopStop = jest.fn();
    jest.spyOn(Animated, 'loop').mockImplementation(() => ({ start: jest.fn(), stop: loopStop, reset: jest.fn() }) as never);
    const renderer = await render();
    // The first frame may have started the bounce before the system answered; it is stopped as soon as it does.
    expect(loopStop).toHaveBeenCalled();
    const style = renderer.root.findByProps({ testID: 'jelly-brand-mark' }).props.style;
    expect(JSON.stringify(style)).toContain('"scaleX":1');
  });
});
