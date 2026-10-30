import ReactTestRenderer, { act } from 'react-test-renderer';
import { I18nManager, StyleSheet, Text, View } from 'react-native';
import { TrashIcon } from '../../icons/TrashIcon';
import { colors } from '../../theme/tokens';
import i18n from '../../i18n';
import { SwipeableItemRow } from '../SwipeableItemRow';
import { closeOpenRow, useSwipeAwareScrollEnabled } from '../swipeableRowCoordinator';

// The react-native-localize jest mock (see jest.config.js) reports "en-US", so i18n would
// otherwise resolve to English by default - pinned to Korean so this file's label assertions are
// deterministic regardless of that mock's default locale.
beforeAll(async () => {
  await i18n.changeLanguage('ko');
});

function findByAccessibilityLabel(renderer: ReactTestRenderer.ReactTestRenderer, label: string) {
  return renderer.root.findAll(node => node.props.accessibilityLabel === label)[0];
}

/** The share/delete action Pressables are only mounted once the row is actually being dragged/open
 * (see SwipeableItemRow's own isRevealed remarks - a real-device fix for a persistent color-bleed
 * bug at rest) - this fires the same onResponderGrant the real gesture responder system calls the
 * instant a horizontal drag is recognized, so tests that need those buttons can reach them without
 * simulating full PanResponder gesture coordinates. */
// Minimal fake GestureResponderEvent - just enough for PanResponder's internal
// TouchHistoryMath.currentCentroidX/Y (called from its own onResponderGrant) to run without
// throwing; zero active touches means it safely returns TouchHistoryMath.noCentroid rather than
// needing real touch coordinates.
const FAKE_RESPONDER_EVENT = {
  touchHistory: { touchBank: [], numberActiveTouches: 0, indexOfSingleActiveTouch: -1, mostRecentTimeStamp: 0 },
  nativeEvent: {},
};

/** A fake touch history moved (dx, dy) px from the start at time `at` ms, so PanResponder computes gesture.dx/dy (and vx from the previous move). */
function touchesMoved(dx: number, dy = 0, at = 1, previous: readonly [number, number, number] = [0, 0, 0]) {
  return {
    touchHistory: {
      touchBank: [{ touchActive: true, startPageX: 0, startPageY: 0, startTimeStamp: 0, currentPageX: dx, currentPageY: dy, currentTimeStamp: at, previousPageX: previous[0], previousPageY: previous[1], previousTimeStamp: previous[2] }],
      numberActiveTouches: 1,
      indexOfSingleActiveTouch: 0,
      mostRecentTimeStamp: at,
    },
    nativeEvent: {},
  };
}

function contentLayerOf(renderer: ReactTestRenderer.ReactTestRenderer) {
  return renderer.root.findAll(node => Array.isArray(node.props.accessibilityActions))[0];
}

/**
 * A left swipe: grant, the given moves (dx, dy, time), release. The default is one quick, long, flat swipe - past the delete
 * distance. The row is not measured in Jest, so the delete distance is one action width (76).
 */
async function swipeLeft(renderer: ReactTestRenderer.ReactTestRenderer, moves: readonly (readonly [number, number, number])[] = [[-200, 0, 1]]) {
  const layer = contentLayerOf(renderer);
  await act(async () => {
    layer.props.onResponderGrant(FAKE_RESPONDER_EVENT);
    let previous: readonly [number, number, number] = [0, 0, 0];
    for (const [dx, dy, at] of moves) {
      layer.props.onResponderMove(touchesMoved(dx, dy, at, previous));
      previous = [dx, dy, at];
    }
    const [dx, dy, at] = moves[moves.length - 1];
    layer.props.onResponderRelease(touchesMoved(dx, dy, at));
  });
}

/** Drags the row toward `edge`: 'start' (right, uncovers the 공유 pane) or 'end' (left, uncovers the 삭제 pane) - only that pane is mounted. */
async function revealRow(renderer: ReactTestRenderer.ReactTestRenderer, edge: 'start' | 'end' = 'end'): Promise<void> {
  const contentLayer = renderer.root.findAll(node => Array.isArray(node.props.accessibilityActions))[0];
  await act(async () => {
    contentLayer.props.onResponderGrant(FAKE_RESPONDER_EVENT);
    contentLayer.props.onResponderMove(touchesMoved(edge === 'start' ? 40 : -40));
  });
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

describe('SwipeableItemRow as a card wrapper (a pending-request card: icon-only delete, content with controls of its own)', () => {
  afterEach(() => {
    closeOpenRow();
  });

  async function renderCard(onDelete: () => void) {
    let renderer!: ReactTestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = ReactTestRenderer.create(
        <SwipeableItemRow contentAccessible={false} deleteIconOnly deleteLabel="승인 요청 취소" deleteTestID="card-delete" onDelete={onDelete} testID="card">
          <Text>Card</Text>
        </SwipeableItemRow>,
      );
    });
    return renderer;
  }

  it('dragging left shows an icon-only underlay that is not a button; the full swipe asks once, and the label stays an accessibility action', async () => {
    const onDelete = jest.fn();
    const renderer = await renderCard(onDelete);
    await revealRow(renderer);

    const underlay = renderer.root.find(node => node.props.testID === 'card-delete' && node.props.pointerEvents === 'none');
    expect(underlay.findAllByType(Text)).toHaveLength(0);
    expect(renderer.root.findAll(node => node.props.testID === 'card-delete' && typeof node.props.onPress === 'function')).toHaveLength(0);
    expect(onDelete).not.toHaveBeenCalled();
    await act(async () => {
      contentLayerOf(renderer).props.onResponderRelease(touchesMoved(-40));
    });
    // A fling: fast, and past half an action width (38).
    expect(onDelete).toHaveBeenCalledTimes(1);
    expect(contentLayerOf(renderer).props.accessibilityActions).toEqual([{ name: 'delete', label: '승인 요청 취소' }]);
  });

  it('without onPress a tap does nothing, and the content is not one accessible button (its own controls stay reachable)', async () => {
    const renderer = await renderCard(jest.fn());

    const content = renderer.root.find(node => node.props.testID === 'card' && typeof node.props.onPress === 'function');
    expect(content.props.accessible).toBe(false);
    expect(content.props.accessibilityRole).toBeUndefined();
    expect(() => content.props.onPress()).not.toThrow();
  });
});

describe('SwipeableItemRow without a share action (a friend row)', () => {
  afterEach(() => {
    closeOpenRow();
  });

  async function renderDeleteOnly(onDelete: () => void) {
    let renderer!: ReactTestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = ReactTestRenderer.create(
        <SwipeableItemRow onDelete={onDelete} onLongPress={jest.fn()} onPress={jest.fn()} testID="row">
          <Text>Row content</Text>
        </SwipeableItemRow>,
      );
    });
    return renderer;
  }

  it('swipes only toward delete - no 공유 slot is mounted, and the accessibility actions list only delete', async () => {
    const onDelete = jest.fn();
    const renderer = await renderDeleteOnly(onDelete);
    await swipeLeft(renderer);

    expect(findByAccessibilityLabel(renderer, i18n.t('common.share'))).toBeUndefined();
    expect(onDelete).toHaveBeenCalledTimes(1);
    const layer = renderer.root.findAll(node => Array.isArray(node.props.accessibilityActions))[0];
    // The long-press menu (renderDeleteOnly passes one) is an accessibility action too, so it never needs the gesture.
    expect(layer.props.accessibilityActions.map((action: { name: string }) => action.name)).toEqual(['delete', 'options']);
  });

  it('offers 바로가기 as a screen-reader action (the in-card icon is not focusable inside the one-button row) only when given', async () => {
    const onOpenOriginal = jest.fn();
    let renderer!: ReactTestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = ReactTestRenderer.create(<SwipeableItemRow onOpenOriginal={onOpenOriginal} onPress={jest.fn()}><Text>Row</Text></SwipeableItemRow>);
    });
    const layer = renderer.root.findAll(node => Array.isArray(node.props.accessibilityActions))[0];
    expect(layer.props.accessibilityActions).toEqual([{ name: 'openOriginal', label: i18n.t('item.goToUrlA11y') }]);
    act(() => layer.props.onAccessibilityAction({ nativeEvent: { actionName: 'openOriginal' } }));
    expect(onOpenOriginal).toHaveBeenCalledTimes(1);
  });

  it('offers the options accessibility action only when there is a long-press menu, and it opens that menu', async () => {
    const onLongPress = jest.fn();
    let renderer!: ReactTestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = ReactTestRenderer.create(<SwipeableItemRow onLongPress={onLongPress} onPress={jest.fn()}><Text>Row</Text></SwipeableItemRow>);
    });
    const layer = renderer.root.findAll(node => Array.isArray(node.props.accessibilityActions))[0];
    expect(layer.props.accessibilityActions).toEqual([{ name: 'options', label: i18n.t('collections.linkActionsA11y') }]);
    act(() => layer.props.onAccessibilityAction({ nativeEvent: { actionName: 'options' } }));
    expect(onLongPress).toHaveBeenCalledTimes(1);

    await act(async () => {
      renderer.update(<SwipeableItemRow onPress={jest.fn()}><Text>Row</Text></SwipeableItemRow>);
    });
    expect(renderer.root.findAll(node => Array.isArray(node.props.accessibilityActions))[0].props.accessibilityActions).toEqual([]);
  });

  it('forwards the long press to the row content (the tap and the long press are separate)', async () => {
    const renderer = await renderDeleteOnly(jest.fn());

    const content = renderer.root.find(node => node.props.testID === 'row' && typeof node.props.onPress === 'function');
    expect(content.props.onLongPress).toEqual(expect.any(Function));
  });
});

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

  it('a left swipe past the delete distance asks onDelete once, springs back and leaves no delete button behind', async () => {
    const onDelete = jest.fn();
    const onPress = jest.fn();
    const renderer = await renderRow({ onPress, onDelete, onShare: jest.fn() });
    // Slow (so it is the distance that counts, not a fling): -40, then -120 a second later, then held still.
    await swipeLeft(renderer, [[-40, 0, 1], [-120, 0, 1000], [-120, 0, 2000]]);

    expect(onDelete).toHaveBeenCalledTimes(1);
    expect(findByAccessibilityLabel(renderer, '삭제')).toBeUndefined();
    // Not left open: the next tap navigates instead of closing a revealed row.
    const content = renderer.root.findAll(node => typeof node.props.onPress === 'function' && node.props.accessibilityLabel === undefined)[0];
    await act(async () => content.props.onPress());
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('a short slow left drag springs back without asking', async () => {
    const onDelete = jest.fn();
    const renderer = await renderRow({ onPress: jest.fn(), onDelete, onShare: jest.fn() });
    await swipeLeft(renderer, [[-30, 0, 1], [-60, 0, 1000], [-60, 0, 2000]]);

    expect(onDelete).not.toHaveBeenCalled();
  });

  it('a quick fling past half an action width asks to delete, a tiny fast one does not', async () => {
    const flung = jest.fn();
    await swipeLeft(await renderRow({ onPress: jest.fn(), onDelete: flung, onShare: jest.fn() }), [[-50, 0, 50]]);
    expect(flung).toHaveBeenCalledTimes(1);

    const tiny = jest.fn();
    await swipeLeft(await renderRow({ onPress: jest.fn(), onDelete: tiny, onShare: jest.fn() }), [[-20, 0, 5]]);
    expect(tiny).not.toHaveBeenCalled();
  });

  it('a diagonal move never deletes, however far it went', async () => {
    const onDelete = jest.fn();
    const renderer = await renderRow({ onPress: jest.fn(), onDelete, onShare: jest.fn() });
    await swipeLeft(renderer, [[-200, -150, 1]]);

    expect(onDelete).not.toHaveBeenCalled();
  });

  it('a mostly vertical move is never taken as a swipe at all', async () => {
    const renderer = await renderRow({ onPress: jest.fn(), onDelete: jest.fn(), onShare: jest.fn() });
    const layer = contentLayerOf(renderer);
    expect(layer.props.onMoveShouldSetResponder(touchesMoved(-12, 40))).toBe(false);
    expect(layer.props.onMoveShouldSetResponder(touchesMoved(-4, 0))).toBe(false);
  });

  it('one swipe asks once, even if the release is reported again; the next swipe can ask again', async () => {
    const onDelete = jest.fn();
    const renderer = await renderRow({ onPress: jest.fn(), onDelete, onShare: jest.fn() });
    await swipeLeft(renderer);
    await act(async () => {
      contentLayerOf(renderer).props.onResponderRelease(touchesMoved(-200));
    });
    expect(onDelete).toHaveBeenCalledTimes(1);

    await swipeLeft(renderer);
    expect(onDelete).toHaveBeenCalledTimes(2);
  });

  it('calls onShare when the revealed share action is pressed', async () => {
    const onShare = jest.fn();
    const renderer = await renderRow({ onPress: jest.fn(), onDelete: jest.fn(), onShare });
    await revealRow(renderer, 'start');

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

    // A disabled row is not taken as a swipe at all.
    expect(contentLayerOf(renderer).props.onMoveShouldSetResponder(touchesMoved(-200))).toBe(false);
    let other!: ReactTestRenderer.ReactTestRenderer;
    await act(async () => {
      other = ReactTestRenderer.create(
        <SwipeableItemRow disabled onDelete={jest.fn()} onPress={onPress} onShare={jest.fn()}>
          <Text>Row content</Text>
        </SwipeableItemRow>,
      );
    });
    await revealRow(other, 'start');
    const shareAction = findByAccessibilityLabel(other, '공유');
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

  // Regression test for a real-device report: a persistent thin red/blue sliver (the delete/share
  // action backgrounds) was visible at the left/right edge of every row at rest, most noticeably on
  // the narrower Grid card width. The action backgrounds are no longer just visually covered by the
  // content layer while at rest - they are not mounted at all until a swipe genuinely begins, which
  // makes that class of edge-registration/rounding bleed-through structurally impossible.
  it('mounts only the pane of the dragged edge, so the other action colour can never show through', async () => {
    const renderer = await renderRow({ onPress: jest.fn(), onDelete: jest.fn(), onShare: jest.fn() });
    await revealRow(renderer, 'start');
    expect(findByAccessibilityLabel(renderer, '공유')).toBeDefined();
    expect(findByAccessibilityLabel(renderer, '삭제')).toBeUndefined();
    const other = await renderRow({ onPress: jest.fn(), onDelete: jest.fn(), onShare: jest.fn() });
    await revealRow(other, 'end');
    expect(other.root.findAll(node => node.props.pointerEvents === 'none')).not.toHaveLength(0);
    expect(findByAccessibilityLabel(other, '공유')).toBeUndefined();
  });

  it('does not mount the swipe action backgrounds at rest, only once a swipe actually begins', async () => {
    const renderer = await renderRow({ onPress: jest.fn(), onDelete: jest.fn(), onShare: jest.fn() });

    expect(renderer.root.findAll(node => node.props.pointerEvents === 'box-none')).toHaveLength(0);

    await revealRow(renderer);

    const actionsOverlay = renderer.root.findAll(node => node.props.pointerEvents === 'box-none')[0];
    const contentLayer = renderer.root.findAll(
      node => Array.isArray(node.props.accessibilityActions),
    )[0];
    expect(actionsOverlay).toBeTruthy();
    expect(actionsOverlay.parent).toBe(contentLayer.parent);
    const siblings = actionsOverlay.parent!.children;
    // Declared (and therefore painted) before the content layer - RN stacks later siblings on
    // top, so the actions are only ever visible once the content slides away via translateX.
    expect(siblings.indexOf(actionsOverlay)).toBeLessThan(siblings.indexOf(contentLayer as never));
  });
});

describe('SwipeableItemRow startAction (a generic start-side action in place of 공유)', () => {
  afterEach(() => {
    closeOpenRow();
  });

  it('reveals the custom action with its label; swiping alone does not run it, a tap does', async () => {
    const onPress = jest.fn();
    let renderer!: ReactTestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = ReactTestRenderer.create(
        <SwipeableItemRow onDelete={jest.fn()} startAction={{ icon: () => null, label: '복구', onPress, testID: 'start-action' }}>
          <Text>Row</Text>
        </SwipeableItemRow>,
      );
    });
    await revealRow(renderer, 'start');

    expect(onPress).not.toHaveBeenCalled();
    expect(findByAccessibilityLabel(renderer, i18n.t('common.share'))).toBeUndefined();
    const action = renderer.root.find(node => node.props.testID === 'start-action' && typeof node.props.onPress === 'function');
    expect(action.props.accessibilityLabel).toBe('복구');
    await act(async () => {
      action.props.onPress();
    });
    expect(onPress).toHaveBeenCalledTimes(1);
  });
});

describe('SwipeableItemRow vs. the list\'s vertical scroll (a horizontal swipe keeps the gesture)', () => {
  function ScrollProbe({ onValue }: { readonly onValue: (enabled: boolean) => void }) {
    onValue(useSwipeAwareScrollEnabled());
    return null;
  }

  afterEach(() => {
    closeOpenRow();
  });

  async function renderWithProbe() {
    const values: boolean[] = [];
    let renderer!: ReactTestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = ReactTestRenderer.create(
        <View>
          <ScrollProbe onValue={value => values.push(value)} />
          <SwipeableItemRow onDelete={jest.fn()} onPress={jest.fn()} onShare={jest.fn()}>
            <Text>Row content</Text>
          </SwipeableItemRow>
        </View>,
      );
    });
    const content = renderer.root.findAll(node => Array.isArray(node.props.accessibilityActions))[0];
    return { renderer, content, scrollEnabled: () => values[values.length - 1] };
  }

  it('the list stops scrolling from the moment the swipe is recognized until the finger lifts', async () => {
    const { content, scrollEnabled } = await renderWithProbe();
    expect(scrollEnabled()).toBe(true);

    await act(async () => {
      content.props.onResponderGrant(FAKE_RESPONDER_EVENT);
      content.props.onResponderMove(touchesMoved(-40));
    });
    expect(scrollEnabled()).toBe(false);

    await act(async () => {
      content.props.onResponderRelease(touchesMoved(-40));
    });
    expect(scrollEnabled()).toBe(true);
  });

  it('a scroll view asking for the touch mid-swipe is refused', async () => {
    const { content } = await renderWithProbe();
    await act(async () => {
      content.props.onResponderGrant(FAKE_RESPONDER_EVENT);
    });
    expect(content.props.onResponderTerminationRequest(FAKE_RESPONDER_EVENT)).toBe(false);
  });

  it('an interrupted left swipe never deletes (nobody released it) and never leaves the list frozen', async () => {
    const onDelete = jest.fn();
    const values: boolean[] = [];
    let renderer!: ReactTestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = ReactTestRenderer.create(
        <View>
          <ScrollProbe onValue={value => values.push(value)} />
          <SwipeableItemRow onDelete={onDelete} onPress={jest.fn()} onShare={jest.fn()}>
            <Text>Row content</Text>
          </SwipeableItemRow>
        </View>,
      );
    });
    const content = contentLayerOf(renderer);
    await act(async () => {
      content.props.onResponderGrant(FAKE_RESPONDER_EVENT);
      content.props.onResponderMove(touchesMoved(-200));
      content.props.onResponderTerminate(touchesMoved(-200));
    });

    expect(values[values.length - 1]).toBe(true);
    expect(onDelete).not.toHaveBeenCalled();
  });

  it('an interrupted swipe past the share threshold stays open (not snapped shut)', async () => {
    const { renderer, content } = await renderWithProbe();
    await act(async () => {
      content.props.onResponderGrant(FAKE_RESPONDER_EVENT);
      content.props.onResponderMove(touchesMoved(200));
      content.props.onResponderTerminate(touchesMoved(200));
    });

    expect(findByAccessibilityLabel(renderer, i18n.t('common.share'))).toBeDefined();
  });
});

describe('SwipeableItemRow - the red underlay while swiping toward delete', () => {
  afterEach(() => {
    closeOpenRow();
  });

  async function renderDeletable(onDelete: () => void = jest.fn(), onShare: () => void = jest.fn()) {
    let renderer!: ReactTestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = ReactTestRenderer.create(
        <SwipeableItemRow deleteTestID="under" onDelete={onDelete} onPress={jest.fn()} onShare={onShare}>
          <Text>Row</Text>
        </SwipeableItemRow>,
      );
    });
    return renderer;
  }

  it('shows the destructive red with a white trash centred vertically, moving with the drag, and it is not a button', async () => {
    const renderer = await renderDeletable();
    await revealRow(renderer);
    const under = renderer.root.findAll(node => node.props.testID === 'under' && node.props.pointerEvents === 'none')[0];
    expect(StyleSheet.flatten(under.props.style)).toEqual(expect.objectContaining({ backgroundColor: colors.destructive, justifyContent: 'center' }));
    expect(under.findByType(TrashIcon).props.color).toBe('#FFFFFF');
    const slot = under.findAll(node => typeof node.type === 'string' && StyleSheet.flatten(node.props.style)?.width === 22)[0];
    expect(StyleSheet.flatten(slot.props.style)).toEqual(expect.objectContaining({ end: -11, width: 22, height: 22 }));
    expect(renderer.root.findAll(node => node.props.testID === 'under' && typeof node.props.onPress === 'function')).toHaveLength(0);
  });

  describe('RTL', () => {
    const original = I18nManager.isRTL;
    beforeAll(() => {
      Object.defineProperty(I18nManager, 'isRTL', { configurable: true, value: true });
    });
    afterAll(() => {
      Object.defineProperty(I18nManager, 'isRTL', { configurable: true, value: original });
    });

    it('the delete side is the physical left edge: a right swipe asks to delete, a left swipe opens 공유 and deletes nothing', async () => {
      const onDelete = jest.fn();
      const renderer = await renderDeletable(onDelete);
      const swipe = async (dx: number) => {
        const layer = contentLayerOf(renderer);
        await act(async () => {
          layer.props.onResponderGrant(FAKE_RESPONDER_EVENT);
          layer.props.onResponderMove(touchesMoved(dx));
          layer.props.onResponderRelease(touchesMoved(dx));
        });
      };
      await swipe(-200);
      expect(onDelete).not.toHaveBeenCalled();
      expect(findByAccessibilityLabel(renderer, '공유')).toBeDefined();
      await act(async () => closeOpenRow());
      await swipe(200);
      expect(onDelete).toHaveBeenCalledTimes(1);
    });
  });
});
