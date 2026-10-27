import { useState } from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';
import { ActivityIndicator, Platform, RefreshControl, View } from 'react-native';
import { usePullToRefresh } from '../PullRefreshControl';
import { darkColors, getActiveColorScheme, lightColors, setActiveColorScheme } from '../../theme/tokens';

const palettes = { light: lightColors, dark: darkColors };

const originalOS = Platform.OS;
const originalScheme = getActiveColorScheme();
afterEach(() => {
  Object.defineProperty(Platform, 'OS', { value: originalOS, configurable: true });
  setActiveColorScheme(originalScheme);
});

/**
 * A list stand-in that behaves like the real screens: the pull's onRefresh sets "a request is running" in the same update, the
 * request itself is a function the test finishes (success or failure) - and anything else the screen renders stays as it is.
 */
let control: { finish: () => void; startBackground: () => void; requests: number };
function Screen({ startsRequest = true }: { readonly startsRequest?: boolean }) {
  const [refreshing, setRefreshing] = useState(false);
  control.finish = () => setRefreshing(false);
  control.startBackground = () => setRefreshing(true);
  const { refreshControl } = usePullToRefresh(refreshing, () => {
    control.requests += 1;
    if (startsRequest) {
      setRefreshing(true);
    }
  });
  return <View testID="list">{refreshControl}</View>;
}

function render(props: { startsRequest?: boolean } = {}) {
  control = { finish: () => undefined, startBackground: () => undefined, requests: 0 };
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  act(() => {
    renderer = ReactTestRenderer.create(<Screen {...props} />);
  });
  return renderer;
}
const nativeControl = (renderer: ReactTestRenderer.ReactTestRenderer) => renderer.root.findByType(RefreshControl);
const nativeRefreshing = (renderer: ReactTestRenderer.ReactTestRenderer) => nativeControl(renderer).props.refreshing;
const pull = (renderer: ReactTestRenderer.ReactTestRenderer) => act(() => nativeControl(renderer).props.onRefresh());

describe.each(['ios', 'android'] as const)('usePullToRefresh (%s) - one native spinner', os => {
  beforeEach(() => {
    Object.defineProperty(Platform, 'OS', { value: os, configurable: true });
  });

  it('a pull keeps the native spinner for the whole request - no second, custom spinner or loading row anywhere', () => {
    const renderer = render();
    expect(nativeRefreshing(renderer)).toBe(false);

    pull(renderer);
    expect(control.requests).toBe(1);
    expect(nativeRefreshing(renderer)).toBe(true);
    expect(renderer.root.findAllByType(RefreshControl)).toHaveLength(1);
    expect(renderer.root.findAllByType(ActivityIndicator)).toHaveLength(0);
    expect(renderer.root.findAll(node => node.props.testID === 'pull-refresh-row')).toHaveLength(0);

    act(() => control.finish()); // success or failure: the request is over
    expect(nativeRefreshing(renderer)).toBe(false);
  });

  it('nothing comes back after the end (no late spinner), and a fast answer never shows a second state', () => {
    const renderer = render();
    const seen: boolean[] = [];
    pull(renderer);
    seen.push(nativeRefreshing(renderer));
    act(() => control.finish());
    seen.push(nativeRefreshing(renderer));
    act(() => undefined); // any later effect pass
    seen.push(nativeRefreshing(renderer));
    expect(seen).toEqual([true, false, false]);
  });

  it('a refresh the screen starts by itself (on focus) shows no spinner', () => {
    const renderer = render();
    act(() => control.startBackground());
    expect(nativeRefreshing(renderer)).toBe(false);
    act(() => control.finish());
    expect(nativeRefreshing(renderer)).toBe(false);
  });

  it('a pull during a running refresh joins it: the spinner follows that request and no second request starts', () => {
    const renderer = render();
    act(() => control.startBackground());
    pull(renderer);
    expect(control.requests).toBe(0);
    expect(nativeRefreshing(renderer)).toBe(true);
    act(() => control.finish());
    expect(nativeRefreshing(renderer)).toBe(false);
  });

  it('a pull whose request does not start springs straight back instead of spinning forever', () => {
    const renderer = render({ startsRequest: false });
    pull(renderer);
    expect(control.requests).toBe(1);
    expect(nativeRefreshing(renderer)).toBe(false);
  });

  it('pull after pull works the same way each time, one request each', () => {
    const renderer = render();
    for (let round = 1; round <= 3; round += 1) {
      pull(renderer);
      expect(nativeRefreshing(renderer)).toBe(true);
      act(() => control.finish());
      expect(nativeRefreshing(renderer)).toBe(false);
      expect(control.requests).toBe(round);
    }
  });

  it.each(['light', 'dark'] as const)('takes the %s theme colours', scheme => {
    setActiveColorScheme(scheme);
    const props = nativeControl(render()).props;
    if (os === 'android') {
      // The platform's own round disc behind the spinner: the theme's raised surface, the spinner in the brand colour.
      expect(props.progressBackgroundColor).toBe(palettes[scheme].surfaceRaised);
      expect(props.colors).toEqual([palettes[scheme].brand]);
    } else {
      expect(props.tintColor).toBe(palettes[scheme].textSecondary);
    }
  });
});
