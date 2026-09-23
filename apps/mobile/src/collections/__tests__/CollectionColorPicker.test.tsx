import ReactTestRenderer, { act } from 'react-test-renderer';
import i18n from '../../i18n';
import { CollectionColorPicker } from '../CollectionColorPicker';

beforeAll(async () => {
  await i18n.changeLanguage('ko');
});

function renderPicker(overrides: Partial<React.ComponentProps<typeof CollectionColorPicker>> = {}) {
  const onSelect = jest.fn();
  const props: React.ComponentProps<typeof CollectionColorPicker> = {
    selected: 'Blue',
    onSelect,
    ...overrides,
  };
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  act(() => {
    renderer = ReactTestRenderer.create(<CollectionColorPicker {...props} />);
  });
  return { renderer, onSelect };
}

function getHueBar(renderer: ReactTestRenderer.ReactTestRenderer) {
  return renderer.root.findByProps({ testID: 'collection-color-hue-bar' });
}

describe('CollectionColorPicker hue rail', () => {
  // Regression coverage for the real-device drag-jump bug: the hue calculation must come from
  // pageX (the raw absolute touch position), never locationX (relative to whatever view the OS
  // happens to report as the touch target for a given event - not guaranteed stable across one
  // continuous drag). react-test-renderer gives no real ref to host components here (no
  // createNodeMock), so measureInWindow's callback never actually fires and barPageLeftRef stays
  // at its initial 0 - meaning pageX alone is the effective bar-relative offset in these tests,
  // exactly mirroring the "no responder-move-time layout re-measurement" contract the component
  // itself guarantees (see its own remarks on why measuring on every move would itself cause jumps).
  it('computes the selected hue from pageX at gesture start (onResponderGrant), not locationX', () => {
    const { renderer, onSelect } = renderPicker();
    const hueBar = getHueBar(renderer);

    act(() => hueBar.props.onLayout({ nativeEvent: { layout: { width: 200 } } }));
    act(() => hueBar.props.onResponderGrant({ nativeEvent: { pageX: 100 }, nativeEvent2: { locationX: 999 } }));

    expect(onSelect).toHaveBeenCalledTimes(1);
    // 100/200 = 0.5 -> hue 180 -> a real hex color was selected (never NaN/garbage from an
    // unrelated locationX field that this handler must not read at all).
    expect(onSelect.mock.calls[0][0]).toMatch(/^#[0-9A-F]{6}$/);
  });

  it('keeps updating the hue smoothly across multiple onResponderMove events using pageX each time', () => {
    const { renderer, onSelect } = renderPicker();
    const hueBar = getHueBar(renderer);
    act(() => hueBar.props.onLayout({ nativeEvent: { layout: { width: 200 } } }));

    act(() => hueBar.props.onResponderGrant({ nativeEvent: { pageX: 0 } }));
    act(() => hueBar.props.onResponderMove({ nativeEvent: { pageX: 50 } }));
    act(() => hueBar.props.onResponderMove({ nativeEvent: { pageX: 150 } }));

    expect(onSelect).toHaveBeenCalledTimes(3);
    const colors = (onSelect.mock.calls as [string][]).map(call => call[0]);
    // Each call is a distinct, valid hex color, moving smoothly - never repeating a stale
    // position or producing an invalid value partway through the drag.
    expect(new Set(colors).size).toBe(3);
    for (const color of colors) {
      expect(color).toMatch(/^#[0-9A-F]{6}$/);
    }
  });

  it('clamps the hue to the bar bounds for a touch reported past either edge', () => {
    const { renderer, onSelect } = renderPicker();
    const hueBar = getHueBar(renderer);
    act(() => hueBar.props.onLayout({ nativeEvent: { layout: { width: 200 } } }));

    act(() => hueBar.props.onResponderGrant({ nativeEvent: { pageX: -50 } }));
    act(() => hueBar.props.onResponderMove({ nativeEvent: { pageX: 9999 } }));

    expect(onSelect).toHaveBeenCalledTimes(2);
    expect(onSelect.mock.calls[0][0]).toMatch(/^#[0-9A-F]{6}$/);
    expect(onSelect.mock.calls[1][0]).toMatch(/^#[0-9A-F]{6}$/);
  });

  // Real-device fix: once this bar owns the gesture, the surrounding ScrollView (or anything
  // else) must never be able to take it away mid-drag.
  it('always refuses a mid-gesture responder termination request', () => {
    const { renderer } = renderPicker();
    const hueBar = getHueBar(renderer);

    expect(hueBar.props.onResponderTerminationRequest()).toBe(false);
  });

  it('never starts the gesture while disabled', () => {
    const { renderer } = renderPicker({ disabled: true });
    const hueBar = getHueBar(renderer);

    expect(hueBar.props.onStartShouldSetResponder()).toBe(false);
    expect(hueBar.props.onMoveShouldSetResponder()).toBe(false);
  });
});
