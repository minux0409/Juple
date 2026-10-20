import ReactTestRenderer, { act } from 'react-test-renderer';
import { Platform, RefreshControl } from 'react-native';
import { PullRefreshControl } from '../PullRefreshControl';

const originalOS = Platform.OS;
afterEach(() => {
  Object.defineProperty(Platform, 'OS', { value: originalOS, configurable: true });
});

function render(refreshing: boolean, onRefresh: () => void) {
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  act(() => {
    renderer = ReactTestRenderer.create(<PullRefreshControl onRefresh={onRefresh} refreshing={refreshing} />);
  });
  return renderer;
}
const nativeRefreshing = (renderer: ReactTestRenderer.ReactTestRenderer) => renderer.root.findByType(RefreshControl).props.refreshing;
const update = (renderer: ReactTestRenderer.ReactTestRenderer, refreshing: boolean, onRefresh: () => void) =>
  act(() => renderer.update(<PullRefreshControl onRefresh={onRefresh} refreshing={refreshing} />));

describe('PullRefreshControl', () => {
  it('iOS: a refresh started from code (screen focus) never drives the native spinner, so nothing can be left on screen', () => {
    Object.defineProperty(Platform, 'OS', { value: 'ios', configurable: true });
    const onRefresh = jest.fn();
    const renderer = render(true, onRefresh);
    expect(nativeRefreshing(renderer)).toBe(false);
    update(renderer, false, onRefresh);
    expect(nativeRefreshing(renderer)).toBe(false);
  });

  it('iOS: a pull shows the spinner for exactly the request it started; the next code-started refresh is silent again', () => {
    Object.defineProperty(Platform, 'OS', { value: 'ios', configurable: true });
    const onRefresh = jest.fn();
    const renderer = render(false, onRefresh);

    act(() => renderer.root.findByType(RefreshControl).props.onRefresh());
    expect(onRefresh).toHaveBeenCalledTimes(1);
    update(renderer, true, onRefresh);
    expect(nativeRefreshing(renderer)).toBe(true);

    update(renderer, false, onRefresh); // the request finished (or failed)
    expect(nativeRefreshing(renderer)).toBe(false);

    update(renderer, true, onRefresh); // a later focus refresh
    expect(nativeRefreshing(renderer)).toBe(false);
  });

  it('Android: unchanged - the native control follows `refreshing` for every refresh', () => {
    Object.defineProperty(Platform, 'OS', { value: 'android', configurable: true });
    const onRefresh = jest.fn();
    const renderer = render(true, onRefresh);
    expect(nativeRefreshing(renderer)).toBe(true);
    update(renderer, false, onRefresh);
    expect(nativeRefreshing(renderer)).toBe(false);
  });
});
