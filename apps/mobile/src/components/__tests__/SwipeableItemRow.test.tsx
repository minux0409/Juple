import ReactTestRenderer, { act } from 'react-test-renderer';
import { Text } from 'react-native';
import i18n from '../../i18n';
import { SwipeableItemRow } from '../SwipeableItemRow';
import { closeOpenRow } from '../swipeableRowCoordinator';

// The react-native-localize jest mock (see jest.config.js) reports "en-US", so i18n would
// otherwise resolve to English by default - pinned to Korean so this file's label assertions are
// deterministic regardless of that mock's default locale.
beforeAll(async () => {
  await i18n.changeLanguage('ko');
});

function findByAccessibilityLabel(renderer: ReactTestRenderer.ReactTestRenderer, label: string) {
  return renderer.root.findAll(node => node.props.accessibilityLabel === label)[0];
}

async function renderRow(props: { onPress: () => void; onDelete: () => void; onShare: () => void }) {
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => {
    renderer = ReactTestRenderer.create(
      <SwipeableItemRow onDelete={props.onDelete} onPress={props.onPress} onShare={props.onShare}>
        <Text>Row content</Text>
      </SwipeableItemRow>,
    );
  });
  return renderer;
}

describe('SwipeableItemRow', () => {
  afterEach(() => {
    // Every test starts with a clean "no row open" coordinator state.
    closeOpenRow();
  });

  it('navigates when the content is pressed while closed', async () => {
    const onPress = jest.fn();
    const renderer = await renderRow({ onPress, onDelete: jest.fn(), onShare: jest.fn() });

    const contentPressable = renderer.root.findAll(
      node => typeof node.props.onPress === 'function' && node.props.accessibilityLabel === undefined,
    )[0];
    await act(async () => {
      contentPressable.props.onPress();
    });

    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('exposes delete and share as accessibility actions, so screen-reader users never lose them to the swipe gesture', async () => {
    const onDelete = jest.fn();
    const onShare = jest.fn();
    const renderer = await renderRow({ onPress: jest.fn(), onDelete, onShare });

    const animatedRow = renderer.root.findAll(
      node => Array.isArray(node.props.accessibilityActions),
    )[0];
    expect(animatedRow.props.accessibilityActions).toEqual([
      { name: 'delete', label: expect.any(String) },
      { name: 'share', label: expect.any(String) },
    ]);

    await act(async () => {
      animatedRow.props.onAccessibilityAction({ nativeEvent: { actionName: 'delete' } });
    });
    expect(onDelete).toHaveBeenCalledTimes(1);

    await act(async () => {
      animatedRow.props.onAccessibilityAction({ nativeEvent: { actionName: 'share' } });
    });
    expect(onShare).toHaveBeenCalledTimes(1);
  });

  it('calls onDelete when the revealed delete action is pressed', async () => {
    const onDelete = jest.fn();
    const renderer = await renderRow({ onPress: jest.fn(), onDelete, onShare: jest.fn() });

    const deleteAction = findByAccessibilityLabel(renderer, '삭제');
    await act(async () => {
      deleteAction.props.onPress();
    });

    expect(onDelete).toHaveBeenCalledTimes(1);
  });

  it('calls onShare when the revealed share action is pressed', async () => {
    const onShare = jest.fn();
    const renderer = await renderRow({ onPress: jest.fn(), onDelete: jest.fn(), onShare });

    const shareAction = findByAccessibilityLabel(renderer, '공유');
    await act(async () => {
      shareAction.props.onPress();
    });

    expect(onShare).toHaveBeenCalledTimes(1);
  });

  it('disables the delete/share actions but keeps navigation enabled when disabled', async () => {
    const onPress = jest.fn();
    let renderer!: ReactTestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = ReactTestRenderer.create(
        <SwipeableItemRow disabled onDelete={jest.fn()} onPress={onPress} onShare={jest.fn()}>
          <Text>Row content</Text>
        </SwipeableItemRow>,
      );
    });

    const deleteAction = findByAccessibilityLabel(renderer, '삭제');
    const shareAction = findByAccessibilityLabel(renderer, '공유');
    expect(deleteAction.props.disabled).toBe(true);
    expect(shareAction.props.disabled).toBe(true);

    const contentPressable = renderer.root.findAll(
      node => typeof node.props.onPress === 'function' && node.props.accessibilityLabel === undefined,
    )[0];
    await act(async () => {
      contentPressable.props.onPress();
    });
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('renders the given row content into the tree, unmodified', async () => {
    const renderer = await renderRow({ onPress: jest.fn(), onDelete: jest.fn(), onShare: jest.fn() });

    expect(renderer.root.findByProps({ children: 'Row content' })).toBeTruthy();
  });

  // Regression test for the bug this component previously had: contentPressable used to force
  // flexDirection: 'row' on itself, which stopped its one child (the screen's own row content)
  // from stretching to the full row width - every Home/History row's title/URL/memo rendered at
  // an effectively invisible width as a result. This checks the actual root cause directly
  // (the style that broke the stretch) rather than trying to fake real pixel layout in Jest.
  it('never forces its content wrapper into row-direction sizing, which would stop the row content from stretching to full width', async () => {
    const renderer = await renderRow({ onPress: jest.fn(), onDelete: jest.fn(), onShare: jest.fn() });

    const contentPressable = renderer.root.findAll(
      node => typeof node.props.onPress === 'function' && node.props.accessibilityLabel === undefined,
    )[0];
    const style = contentPressable.props.style as { flexDirection?: string } | undefined;

    expect(style?.flexDirection).not.toBe('row');
  });

  it('keeps the swipe actions layered behind the row content at rest, so they never permanently cover it', async () => {
    const renderer = await renderRow({ onPress: jest.fn(), onDelete: jest.fn(), onShare: jest.fn() });

    const actionsOverlay = renderer.root.findAll(node => node.props.pointerEvents === 'box-none')[0];
    const contentLayer = renderer.root.findAll(
      node => Array.isArray(node.props.accessibilityActions),
    )[0];

    expect(actionsOverlay.parent).toBe(contentLayer.parent);
    const siblings = actionsOverlay.parent!.children;
    // Declared (and therefore painted) before the content layer - RN stacks later siblings on
    // top, so the actions are only ever visible once the content slides away via translateX.
    expect(siblings.indexOf(actionsOverlay)).toBeLessThan(siblings.indexOf(contentLayer as never));
  });
});
