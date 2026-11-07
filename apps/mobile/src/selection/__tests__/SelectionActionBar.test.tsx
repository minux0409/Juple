import ReactTestRenderer, { act } from 'react-test-renderer';
import { Text } from 'react-native';
import i18n from '../../i18n';
import { StyleSheet } from 'react-native';
import { SelectionBarSlot } from '../SelectionActionBar';
import { SelectionBarProvider, useSelectionBar, type SelectionBarModel } from '../SelectionBarContext';

jest.mock('@react-navigation/bottom-tabs', () => {
  const React = require('react');
  return { BottomTabBarHeightCallbackContext: React.createContext(undefined) };
});
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 34, left: 0 }),
}));

const icon = () => null;

function Owner({ model }: { readonly model: SelectionBarModel | null }) {
  useSelectionBar(model);
  return <Text>owner</Text>;
}

function Slot() {
  return <SelectionBarSlot fallback={<Text>tabs</Text>} />;
}

function mount(model: SelectionBarModel | null) {
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  act(() => {
    renderer = ReactTestRenderer.create(
      <SelectionBarProvider>
        <Owner model={model} />
        <Slot />
      </SelectionBarProvider>,
    );
  });
  return renderer;
}

const press = (renderer: ReactTestRenderer.ReactTestRenderer, testID: string) => {
  const node = renderer.root.findByProps({ testID });
  act(() => node.props.onPress());
};

describe('SelectionActionBar replaces the tab bar while selecting', () => {
  beforeAll(async () => { await i18n.changeLanguage('en'); });

  it('shows the tab bar when nothing is selecting, and the action bar when a screen is', () => {
    const idle = mount(null);
    expect(idle.root.findAllByProps({ testID: 'selection-action-bar' })).toHaveLength(0);
    expect(JSON.stringify(idle.toJSON())).toContain('tabs');

    const selecting = mount({ actions: [{ key: 'delete', label: 'Delete', icon, onPress: jest.fn() }] });
    expect(selecting.root.findAllByProps({ testID: 'selection-action-bar' }).length).toBeGreaterThan(0);
    expect(JSON.stringify(selecting.toJSON())).not.toContain('"tabs"');
  });

  it('is a floating card: inset from the sides, rounded, shadowed, lifted above the system inset - not a tab-bar-like strip', () => {
    const renderer = mount({ actions: [{ key: 'delete', label: 'Delete', icon, onPress: jest.fn() }] });
    const slot = StyleSheet.flatten(renderer.root.findByProps({ testID: 'selection-action-bar' }).props.style);
    const card = StyleSheet.flatten(renderer.root.findByProps({ testID: 'selection-action-card' }).props.style);
    // The mocked bottom inset (34) is added once, plus a gap, below the card; the sides have a margin.
    expect(slot.paddingBottom).toBeGreaterThan(34);
    expect(slot.paddingHorizontal).toBeGreaterThan(0);
    expect(card.borderRadius).toBeGreaterThanOrEqual(20);
    expect(card.shadowOpacity).toBeGreaterThan(0);
    expect(card.elevation).toBeGreaterThan(0);
    expect(card.backgroundColor).toBeDefined();
  });

  it('shows no floating bar at all when nothing is selecting', () => {
    const renderer = mount(null);
    expect(renderer.root.findAllByProps({ testID: 'selection-action-card' })).toHaveLength(0);
  });

  it('the tab bar returns when the screen stops selecting', async () => {
    const renderer = mount({ actions: [{ key: 'delete', label: 'Delete', icon, onPress: jest.fn() }] });
    act(() => {
      renderer.update(
        <SelectionBarProvider>
          <Owner model={null} />
          <Slot />
        </SelectionBarProvider>,
      );
    });
    // It leaves with a short animation (touches are already ignored), then the tab bar is back.
    expect(renderer.root.findByProps({ testID: 'selection-action-bar' }).props.pointerEvents).toBe('none');
    await act(async () => { await new Promise<void>(resolve => { setTimeout(resolve, 400); }); });
    expect(renderer.root.findAllByProps({ testID: 'selection-action-bar' })).toHaveLength(0);
    expect(JSON.stringify(renderer.toJSON())).toContain('tabs');
  });

  it('a button runs its action; the newest handler is always the one that runs', () => {
    const first = jest.fn();
    const second = jest.fn();
    const renderer = mount({ actions: [{ key: 'delete', label: 'Delete', icon, onPress: first }] });
    act(() => {
      renderer.update(
        <SelectionBarProvider>
          <Owner model={{ actions: [{ key: 'delete', label: 'Delete', icon, onPress: second }] }} />
          <Slot />
        </SelectionBarProvider>,
      );
    });
    press(renderer, 'selection-action-delete');
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });

  it('a disabled button, and every button while an action is running, cannot be pressed', () => {
    const onPress = jest.fn();
    const renderer = mount({
      actions: [
        { key: 'delete', label: 'Delete', icon, onPress, disabled: true },
        { key: 'copy', label: 'Copy', icon, onPress, busy: true },
      ],
    });
    expect(renderer.root.findByProps({ testID: 'selection-action-delete' }).props.disabled).toBe(true);
    expect(renderer.root.findByProps({ testID: 'selection-action-copy' }).props.disabled).toBe(true);
  });

  it('더보기 opens a compact menu; touching OUTSIDE it only closes it and runs nothing', () => {
    const rowAction = jest.fn();
    const renderer = mount({
      actions: [{ key: 'more', label: 'More', icon, menu: [{ key: 'copyLinks', label: 'Copy links', icon, onPress: rowAction }] }],
    });
    press(renderer, 'selection-action-more');
    expect(renderer.root.findAllByProps({ testID: 'selection-more-menu' }).length).toBeGreaterThan(0);

    press(renderer, 'selection-more-backdrop');
    expect(rowAction).not.toHaveBeenCalled();
    expect(renderer.root.findAllByProps({ testID: 'selection-more-menu' })).toHaveLength(0);
  });

  it('choosing a menu row runs exactly that row', () => {
    const rowAction = jest.fn();
    const renderer = mount({
      actions: [{ key: 'more', label: 'More', icon, menu: [{ key: 'copyLinks', label: 'Copy links', icon, onPress: rowAction }] }],
    });
    press(renderer, 'selection-action-more');
    press(renderer, 'selection-more-copyLinks');
    // iOS runs a menu row only once the menu has finished closing (the Modal's onDismiss) - as the real Modal reports it.
    const dismiss = renderer.root.findAll(node => typeof node.props.onDismiss === 'function')[0];
    act(() => dismiss.props.onDismiss());
    expect(rowAction).toHaveBeenCalledTimes(1);
    // ...and exactly once, whatever else dismisses later.
    act(() => dismiss.props.onDismiss());
    expect(rowAction).toHaveBeenCalledTimes(1);
  });
});
