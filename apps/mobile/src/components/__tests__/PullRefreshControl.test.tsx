import ReactTestRenderer, { act } from 'react-test-renderer';
import { Platform, RefreshControl, View } from 'react-native';
import { usePullToRefresh } from '../PullRefreshControl';

const originalOS = Platform.OS;
afterEach(() => {
  Object.defineProperty(Platform, 'OS', { value: originalOS, configurable: true });
});

/** A list stand-in: the native control, and the row the screen puts at the top of its content. */
function Screen({ refreshing, onRefresh }: { readonly refreshing: boolean; readonly onRefresh: () => void }) {
  const { refreshControl, refreshRow } = usePullToRefresh(refreshing, onRefresh);
  return (
    <View>
      {refreshControl}
      {refreshRow}
    </View>
  );
}

function render(refreshing: boolean, onRefresh: () => void) {
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  act(() => {
    renderer = ReactTestRenderer.create(<Screen onRefresh={onRefresh} refreshing={refreshing} />);
  });
  return renderer;
}
const nativeRefreshing = (renderer: ReactTestRenderer.ReactTestRenderer) => renderer.root.findByType(RefreshControl).props.refreshing;
const hasRow = (renderer: ReactTestRenderer.ReactTestRenderer) => renderer.root.findAll(node => node.props.testID === 'pull-refresh-row').length > 0;
const update = (renderer: ReactTestRenderer.ReactTestRenderer, refreshing: boolean, onRefresh: () => void) =>
  act(() => renderer.update(<Screen onRefresh={onRefresh} refreshing={refreshing} />));

describe.each(['ios', 'android'] as const)('usePullToRefresh (%s) - the loading row of its own', os => {
  beforeEach(() => {
    Object.defineProperty(Platform, 'OS', { value: os, configurable: true });
  });

  it('a pull: the native spinner is put away at once (true, then false) and the row shows until the refresh ends', () => {
    const onRefresh = jest.fn();
    const renderer = render(false, onRefresh);
    expect(hasRow(renderer)).toBe(false);

    act(() => renderer.root.findByType(RefreshControl).props.onRefresh());
    expect(onRefresh).toHaveBeenCalledTimes(1);
    update(renderer, true, onRefresh);
    // Handed off within the same act: the native control ended, the row took over.
    expect(nativeRefreshing(renderer)).toBe(false);
    expect(hasRow(renderer)).toBe(true);

    update(renderer, false, onRefresh); // the request finished (or failed)
    expect(hasRow(renderer)).toBe(false);
    expect(nativeRefreshing(renderer)).toBe(false);
  });

  it('a refresh the screen starts itself (on focus) shows neither the row nor the native spinner', () => {
    const onRefresh = jest.fn();
    const renderer = render(true, onRefresh);
    expect(nativeRefreshing(renderer)).toBe(false);
    expect(hasRow(renderer)).toBe(false);
  });

  it('a second pull after the first ended works the same way again', () => {
    const onRefresh = jest.fn();
    const renderer = render(false, onRefresh);
    for (let round = 0; round < 2; round += 1) {
      act(() => renderer.root.findByType(RefreshControl).props.onRefresh());
      update(renderer, true, onRefresh);
      expect(hasRow(renderer)).toBe(true);
      update(renderer, false, onRefresh);
      expect(hasRow(renderer)).toBe(false);
    }
  });
});
