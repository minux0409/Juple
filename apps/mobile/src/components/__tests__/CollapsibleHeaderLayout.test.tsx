import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import ReactTestRenderer, { act } from 'react-test-renderer';
import { CollapsibleHeaderLayout, type CollapsibleListBinding } from '../CollapsibleHeaderLayout';

// A native-driven Animated.event is an object; its JS handler (what the native scroll event reaches the listeners through) is __getHandler().
const emit = (binding: CollapsibleListBinding, y: number) =>
  (binding.onScroll as unknown as { __getHandler(): (event: unknown) => void }).__getHandler()({ nativeEvent: { contentOffset: { x: 0, y } } });
const layout = (height: number) => ({ nativeEvent: { layout: { height, width: 300, x: 0, y: 0 } } });

function setup(props: Partial<React.ComponentProps<typeof CollapsibleHeaderLayout>> = {}) {
  const seen: { binding?: CollapsibleListBinding; state?: { isCollapsed: boolean } } = {};
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  act(() => {
    renderer = ReactTestRenderer.create(
      <CollapsibleHeaderLayout
        collapsible={<Text>collapsible</Text>}
        pinned={state => { seen.state = state; return <Text>{state.isCollapsed ? 'pinned-collapsed' : 'pinned'}</Text>; }}
        testID="header"
        {...props}
      >
        {binding => { seen.binding = binding; return <View testID="list" />; }}
      </CollapsibleHeaderLayout>,
    );
  });
  // [0] is the list viewport wrapper; the header's collapsible and pinned wrappers follow.
  const all = () => renderer.root.findAll(node => typeof node.type === 'string' && typeof node.props.onLayout === 'function');
  const hostWithLayout = () => all().slice(1);
  const viewport = () => all()[0];
  return { renderer, seen, hostWithLayout, viewport };
}

describe('CollapsibleHeaderLayout', () => {
  it('keeps the list invisible until the header is measured, then reserves its full height (collapsible + pinned) above the first row', () => {
    const { renderer, seen, hostWithLayout } = setup();
    const hidden = () => renderer.root.findAll(node => typeof node.type === 'string' && StyleSheet.flatten(node.props.style)?.opacity === 0);
    expect(seen.binding!.topInset).toBe(0);
    expect(hidden()).toHaveLength(1);
    const [collapsible, pinned] = hostWithLayout();
    act(() => { collapsible.props.onLayout(layout(180)); });
    act(() => { pinned.props.onLayout(layout(60)); });
    expect(seen.binding!.topInset).toBe(240);
    expect(hidden()).toHaveLength(0);
  });

  it('a header with only a pinned part has nothing to collapse, and a missing part is measured as 0', () => {
    const { seen, hostWithLayout } = setup({ collapsible: null });
    act(() => { hostWithLayout()[0].props.onLayout(layout(72)); });
    expect(seen.binding!.topInset).toBe(72);
  });

  it('reports collapsed once the list has scrolled past the collapsible part, and expanded again at the top', () => {
    const { seen, hostWithLayout, renderer } = setup();
    const [collapsible, pinned] = hostWithLayout();
    act(() => { collapsible.props.onLayout(layout(180)); pinned.props.onLayout(layout(60)); });
    const scroll = (y: number) => act(() => { emit(seen.binding!, y); });
    scroll(90);
    expect(seen.binding!.isCollapsed).toBe(false);
    scroll(200);
    expect(seen.binding!.isCollapsed).toBe(true);
    expect(renderer.root.findAllByType(Text).some(node => node.props.children === 'pinned-collapsed')).toBe(true);
    scroll(0);
    expect(seen.binding!.isCollapsed).toBe(false);
  });

  it('forwards every scroll event to the screen listener and returns to expanded when resetKey changes', () => {
    const listener = jest.fn();
    const { seen, hostWithLayout, renderer } = setup({ onScrollEvent: listener, resetKey: 'a' });
    const [collapsible, pinned] = hostWithLayout();
    act(() => { collapsible.props.onLayout(layout(100)); pinned.props.onLayout(layout(50)); });
    act(() => { emit(seen.binding!, 150); });
    expect(listener).toHaveBeenCalledTimes(1);
    expect(seen.binding!.isCollapsed).toBe(true);
    act(() => {
      renderer.update(
        <CollapsibleHeaderLayout collapsible={<Text>collapsible</Text>} pinned={<Text>pinned</Text>} resetKey="b" testID="header">
          {binding => { seen.binding = binding; return <View testID="list" />; }}
        </CollapsibleHeaderLayout>,
      );
    });
    expect(seen.binding!.isCollapsed).toBe(false);
  });

  it('guarantees a list with rows can scroll far enough to collapse the header (viewport + collapsible height); empty lists keep their natural height', () => {
    const { seen, hostWithLayout, viewport } = setup();
    const [collapsible, pinned] = hostWithLayout();
    act(() => { viewport().props.onLayout(layout(700)); collapsible.props.onLayout(layout(180)); pinned.props.onLayout(layout(60)); });
    expect(seen.binding!.contentInset(true)).toEqual({ minHeight: 880, paddingTop: 240 });
    expect(seen.binding!.contentInset(false)).toEqual({ minHeight: undefined, paddingTop: 240 });
  });

  it('collapsedExtra: the pinned part may offer its own copy of a control only once the list copy (a row just below it) has scrolled away', () => {
    const { seen, hostWithLayout } = setup({ collapsedExtra: 56 });
    const [collapsible, pinned] = hostWithLayout();
    act(() => { collapsible.props.onLayout(layout(100)); pinned.props.onLayout(layout(60)); });
    act(() => { emit(seen.binding!, 120); }); // docked (100) but the row below is still visible
    expect(seen.binding!.isCollapsed).toBe(false);
    act(() => { emit(seen.binding!, 160); }); // 100 + 56: gone
    expect(seen.binding!.isCollapsed).toBe(true);
    // The list can always be scrolled far enough for that.
    expect(seen.binding!.contentInset(true).paddingTop).toBe(160);
  });
});
