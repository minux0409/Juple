import { NavigationContainer } from '@react-navigation/native';
import type { ComponentProps } from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';
import { Platform, StyleSheet, Text } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import i18n from '../../i18n';
import { iosHeaderOptions, iosLeadingTitleOptions } from '../sheetHeader';

const originalOS = Platform.OS;
const metrics = { frame: { x: 0, y: 0, width: 400, height: 800 }, insets: { top: 62, left: 0, right: 0, bottom: 34 } };

afterEach(() => {
  Object.defineProperty(Platform, 'OS', { value: originalOS, configurable: true });
});

type HeaderProps = ComponentProps<NonNullable<ReturnType<typeof iosHeaderOptions>['header']>>;

function renderHeader(options: ReturnType<typeof iosHeaderOptions>, props: { back?: boolean; screen?: Record<string, unknown> } = {}) {
  const goBack = jest.fn();
  const headerProps = {
    back: props.back === false ? undefined : { title: 'Prev', href: undefined },
    navigation: { goBack },
    options: props.screen ?? {},
    route: { key: 'r', name: 'R' },
  } as unknown as HeaderProps;
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  act(() => {
    renderer = ReactTestRenderer.create(
      <SafeAreaProvider initialMetrics={metrics}>
        <NavigationContainer>{options.header!(headerProps)}</NavigationContainer>
      </SafeAreaProvider>,
    );
  });
  return { renderer, goBack };
}
const bar = (renderer: ReactTestRenderer.ReactTestRenderer) =>
  renderer.root.findAll(node => node.props.testID === 'ios-stack-header' && typeof node.type === 'string')[0];

describe('the iOS stack header (drawn in the screen, so it moves with the screen)', () => {
  beforeEach(() => {
    Object.defineProperty(Platform, 'OS', { value: 'ios', configurable: true });
  });

  it('never uses the system bar\'s items: the whole header is the screen\'s own', () => {
    const options = iosLeadingTitleOptions(<Text>T</Text>);
    expect(options.header).toEqual(expect.any(Function));
    expect(options).not.toHaveProperty('unstable_headerLeftItems');
    expect(iosHeaderOptions()).not.toHaveProperty('unstable_headerLeftItems');
  });

  it('shows the arrow, which goes back, and the title element', () => {
    const { renderer, goBack } = renderHeader(iosLeadingTitleOptions(<Text>Title element</Text>));
    const button = renderer.root.findByProps({ testID: 'header-back', accessibilityRole: 'button' });
    expect(button.props.accessibilityLabel).toBe(i18n.t('common.back'));
    act(() => button.props.onPress());
    expect(goBack).toHaveBeenCalledTimes(1);
    expect(renderer.root.findByProps({ children: 'Title element' })).toBeTruthy();
  });

  it('a plain title is shown when the screen has no title element; a first screen has no arrow', () => {
    const { renderer } = renderHeader(iosHeaderOptions(), { back: false, screen: { title: 'Plain' } });
    expect(renderer.root.findByProps({ children: 'Plain' })).toBeTruthy();
    expect(renderer.root.findAllByProps({ testID: 'header-back' })).toHaveLength(0);
  });

  it('the arrow is a square control centred on the glyph, its layout width and touch area unchanged', () => {
    const { renderer } = renderHeader(iosHeaderOptions());
    const button = renderer.root.findByProps({ testID: 'header-back', accessibilityRole: 'button' });
    const style = StyleSheet.flatten(button.props.style);
    expect(style).toEqual(expect.objectContaining({ width: 44, height: 44, marginStart: -10, marginEnd: -10 }));
    expect(button.props.hitSlop).toEqual({ top: 10, bottom: 10, left: 6, right: 6 });
  });

  it('the compact bar (a Collection) puts its title after the arrow at the toolbar icons\' spacing; the other screens keep theirs', () => {
    const titleBox = (renderer: ReactTestRenderer.ReactTestRenderer) =>
      renderer.root.findByProps({ children: 'Name' }).parent!.parent!;
    const regular = renderHeader(iosLeadingTitleOptions(<Text>Name</Text>)).renderer;
    expect(StyleSheet.flatten(titleBox(regular).props.style)).toEqual(expect.objectContaining({ marginStart: 32, flex: 1, minWidth: 0 }));
    // 16pt after the arrow's box = ~20pt of air after its ink (it ends 4pt inside the box), as between the favorite and share icons.
    const compact = renderHeader(iosLeadingTitleOptions(<Text>Name</Text>, true)).renderer;
    expect(StyleSheet.flatten(titleBox(compact).props.style)).toEqual(expect.objectContaining({ marginStart: 16, flex: 1, minWidth: 0 }));
    // The arrow keeps its full touch area.
    const arrow = compact.root.findByProps({ testID: 'header-back', accessibilityRole: 'button' });
    expect(StyleSheet.flatten(arrow.props.style)).toEqual(expect.objectContaining({ width: 44, height: 44 }));
  });

  it('sits under the status bar on a pushed screen; a page sheet has no status bar inset', () => {
    expect(StyleSheet.flatten(bar(renderHeader(iosHeaderOptions()).renderer).props.style).paddingTop).toBe(62);
    expect(StyleSheet.flatten(bar(renderHeader(iosHeaderOptions(), { screen: { presentation: 'modal' } }).renderer).props.style).paddingTop).toBe(20);
  });

  it('renders the screen\'s headerRight (a live action such as 모두 읽음)', () => {
    const { renderer } = renderHeader(iosHeaderOptions(), { screen: { title: 'T', headerRight: () => <Text>Action</Text> } });
    expect(renderer.root.findByProps({ children: 'Action' })).toBeTruthy();
  });
});

describe('Android', () => {
  it('sets nothing on the root stack (the native header arrow and system back stay as they are)', () => {
    Object.defineProperty(Platform, 'OS', { value: 'android', configurable: true });
    expect(iosHeaderOptions()).toEqual({});
  });
});
