import ReactTestRenderer, { act } from 'react-test-renderer';
import { Image, PanResponder } from 'react-native';
import i18n from '../../i18n';
import { PhotoListEditor } from '../PhotoListEditor';
import type { EffectiveImage } from '../../items/effectiveImages';

beforeAll(async () => {
  await i18n.changeLanguage('ko');
});

// PanResponder.create's real implementation derives its own gestureState (dx/dy/...) from raw
// touch history, which isn't meaningfully reproducible through react-test-renderer's synthetic
// events. Stubbed (for the drag-gesture describe block below only) to expose the exact
// onPanResponder* config object as panHandlers instead, so those tests can call
// onPanResponderGrant/-Move/-Release directly with a hand-built gestureState - testing PhotoTrack's
// own reorder decision logic, not RN's touch tracking (already covered by twoSlotDrag.test.ts, and
// not what the stale-closure bug under test is about).
function stubPanResponderCreate(): jest.SpyInstance {
  return jest.spyOn(PanResponder, 'create').mockImplementation(
    config =>
      ({
        panHandlers: config as unknown as Record<string, unknown>,
        getInteractionHandle: () => undefined,
      }) as unknown as ReturnType<typeof PanResponder.create>,
  );
}

function makeUploaded(id: number, readUrl: string): EffectiveImage {
  return { kind: 'uploaded', image: { id, contentType: 'image/jpeg', byteLength: 1, sortOrder: 0, createdAtUtc: '', readUrl } };
}

interface RenderOverrides {
  readonly deletingKeys?: ReadonlySet<string>;
  readonly images?: readonly EffectiveImage[];
  readonly isAdding?: boolean;
  readonly onAddPhoto?: () => void;
  readonly onDeleteImage?: (image: EffectiveImage) => void;
  readonly onReorder?: (fromIndex: number, toIndex: number) => void;
}

function renderPhotoListEditor(overrides: RenderOverrides = {}) {
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  act(() => {
    renderer = ReactTestRenderer.create(
      <PhotoListEditor
        deletingKeys={overrides.deletingKeys ?? new Set()}
        images={overrides.images ?? []}
        isAdding={overrides.isAdding ?? false}
        onAddPhoto={overrides.onAddPhoto ?? jest.fn()}
        onDeleteImage={overrides.onDeleteImage ?? jest.fn()}
        onReorder={overrides.onReorder ?? jest.fn()}
      />,
    );
  });
  return renderer;
}

function findByAccessibilityLabel(renderer: ReactTestRenderer.ReactTestRenderer, label: string) {
  return renderer.root.findAll(node => node.props.accessibilityLabel === label)[0];
}

/** The 2nd thumbnail's "첫 번째로 설정" accessibility action, if present. */
function findReorderToFrontAction(renderer: ReactTestRenderer.ReactTestRenderer) {
  return renderer.root.findAll(
    node => Array.isArray(node.props.accessibilityActions) && node.props.accessibilityActions.length > 0,
  )[0];
}

/** Every `transform` array anywhere in the rendered tree - used to assert `translateY` never
 * appears anywhere in this component, structurally (not just "wasn't observed to move" at
 * runtime): see twoSlotDrag.ts's own remarks on why only X is ever computed at all. */
function collectTransformKeys(renderer: ReactTestRenderer.ReactTestRenderer): readonly string[] {
  const keys: string[] = [];
  for (const node of renderer.root.findAll(() => true)) {
    const style = node.props.style;
    const flattened = Array.isArray(style) ? style : [style];
    for (const entry of flattened) {
      if (entry && Array.isArray(entry.transform)) {
        for (const transformEntry of entry.transform) {
          keys.push(...Object.keys(transformEntry));
        }
      }
    }
  }
  return keys;
}

describe('PhotoListEditor - 0 photos', () => {
  it('renders the header with a 0 count and no thumbnails', () => {
    const renderer = renderPhotoListEditor({ images: [] });

    expect(renderer.root.findByProps({ children: '사진 (0/2)' })).toBeTruthy();
    expect(renderer.root.findAllByType(Image)).toHaveLength(0);
    expect(findByAccessibilityLabel(renderer, '사진 추가').props.accessibilityState.disabled).toBe(false);
  });
});

describe('PhotoListEditor - 1 photo', () => {
  const images = [makeUploaded(1, 'https://blob.example/1.jpg')];

  it('renders a single static thumbnail with no reorder affordance', () => {
    const renderer = renderPhotoListEditor({ images });

    expect(renderer.root.findAllByType(Image)).toHaveLength(1);
    expect(findReorderToFrontAction(renderer)).toBeUndefined();
  });

  it('deletes the single photo via its × button', () => {
    const onDeleteImage = jest.fn();
    const renderer = renderPhotoListEditor({ images, onDeleteImage });

    act(() => {
      findByAccessibilityLabel(renderer, '사진 삭제').props.onPress();
    });

    expect(onDeleteImage).toHaveBeenCalledWith(images[0]);
  });
});

describe('PhotoListEditor - 2 photos (fixed 2-slot row)', () => {
  const images = [makeUploaded(1, 'https://blob.example/1.jpg'), makeUploaded(2, 'https://blob.example/2.jpg')];

  it('renders exactly two thumbnails', () => {
    const renderer = renderPhotoListEditor({ images });

    expect(renderer.root.findAllByType(Image)).toHaveLength(2);
    expect(renderer.root.findByProps({ children: '사진 (2/2)' })).toBeTruthy();
  });

  it('the add-photo button is disabled once at the 2-photo cap', () => {
    const renderer = renderPhotoListEditor({ images });

    expect(findByAccessibilityLabel(renderer, '사진 추가').props.accessibilityState.disabled).toBe(true);
    expect(renderer.root.findByProps({ children: i18n.t('item.photoLimitButton', { max: 2 }) })).toBeTruthy();
  });

  it('the 2nd thumbnail\'s "첫 번째로 설정" accessibility action reorders it to the front', () => {
    const onReorder = jest.fn();
    const renderer = renderPhotoListEditor({ images, onReorder });

    act(() => {
      findReorderToFrontAction(renderer)?.props.onAccessibilityAction();
    });

    expect(onReorder).toHaveBeenCalledWith(1, 0);
  });

  it('deletes the correct photo when its own × button is pressed', () => {
    const onDeleteImage = jest.fn();
    const renderer = renderPhotoListEditor({ images, onDeleteImage });

    const deleteButtons = renderer.root.findAll(
      node => node.props.accessibilityLabel === '사진 삭제' && typeof node.props.onPress === 'function',
    );
    expect(deleteButtons).toHaveLength(2);
    act(() => {
      deleteButtons[1].props.onPress();
    });

    expect(onDeleteImage).toHaveBeenCalledWith(images[1]);
  });

  it('shows a spinner instead of × for a photo that is currently mid-delete', () => {
    const renderer = renderPhotoListEditor({ images, deletingKeys: new Set(['uploaded-2']) });

    const deleteButtons = renderer.root.findAll(
      node => node.props.accessibilityLabel === '사진 삭제' && typeof node.props.onPress === 'function',
    );
    // Only the still-deletable (image 1) photo has a real delete button - image 2 shows a spinner instead.
    expect(deleteButtons).toHaveLength(1);
  });

  it('re-rendering with only 1 remaining photo after a delete drops back to the single, non-draggable layout', () => {
    const renderer = renderPhotoListEditor({ images });

    act(() => {
      renderer.update(
        <PhotoListEditor
          deletingKeys={new Set()}
          images={[images[0]]}
          isAdding={false}
          onAddPhoto={jest.fn()}
          onDeleteImage={jest.fn()}
          onReorder={jest.fn()}
        />,
      );
    });

    expect(renderer.root.findAllByType(Image)).toHaveLength(1);
    // The remaining photo (image 1) is now in the single-slot position - no reorder action left.
    expect(findReorderToFrontAction(renderer)).toBeUndefined();
  });

  it('never positions anything via translateY - only translateX/scale ever appear', () => {
    const renderer = renderPhotoListEditor({ images });

    const transformKeys = collectTransformKeys(renderer);
    expect(transformKeys.length).toBeGreaterThan(0);
    expect(transformKeys).not.toContain('translateY');
    expect(transformKeys.every(key => key === 'translateX' || key === 'scale')).toBe(true);
  });
});

/** The two slot elements' onPanResponder* config, in slot order (0, then 1) - see the
 * PanResponder.create mock above: panHandlers IS the config object passed to createResponderFor.
 * Animated.View forwards the spread panHandlers through several internal wrapper layers (composite
 * -> forwardRef -> host View), so the SAME config object shows up on multiple fiber nodes per slot -
 * deduped here by object identity (not by node count, which varies by RN/Animated internals) so
 * exactly one entry per slot survives, in slot order. */
function findSlotResponderConfigs(renderer: ReactTestRenderer.ReactTestRenderer) {
  const withRelease = renderer.root.findAll(
    node => typeof node.props.onPanResponderRelease === 'function',
  );
  const seen = new Set<unknown>();
  const configs: unknown[] = [];
  for (const node of withRelease) {
    // Dedupe by the handler function reference itself (identical across every wrapper layer),
    // not the per-layer props object (Animated.View's internal layers each pass through a
    // distinct spread object even though the functions inside are the same reference).
    if (!seen.has(node.props.onPanResponderRelease)) {
      seen.add(node.props.onPanResponderRelease);
      configs.push(node.props);
    }
  }
  return configs as Array<Record<string, (...args: unknown[]) => void>>;
}

function fireTrackLayout(renderer: ReactTestRenderer.ReactTestRenderer, width: number) {
  const trackView = renderer.root.findAll(node => typeof node.props.onLayout === 'function')[0];
  act(() => {
    trackView.props.onLayout({ nativeEvent: { layout: { x: 0, y: 0, width, height: 104 } } });
  });
}

/** Long-press-activates slot `fromIndex`, then releases it at gestureState.dx - mirrors a real
 * drag+drop without needing to reproduce RN's own touch-history gesture tracking (see the
 * PanResponder mock above). Assumes fireTrackLayout was already called so slotPitch/track math is
 * live (release computes drop as null otherwise - see PhotoListEditor.tsx's own trackWidthRef<=0
 * guard). */
function dragAndRelease(
  renderer: ReactTestRenderer.ReactTestRenderer,
  fromIndex: 0 | 1,
  dx: number,
) {
  act(() => {
    const config = findSlotResponderConfigs(renderer)[fromIndex];
    config.onPanResponderGrant({}, { dx: 0, dy: 0 });
    jest.advanceTimersByTime(200);
  });
  act(() => {
    const config = findSlotResponderConfigs(renderer)[fromIndex];
    config.onPanResponderMove({}, { dx, dy: 0 });
    config.onPanResponderRelease({}, { dx, dy: 0 });
  });
}

describe('PhotoListEditor - drag gesture (PanResponder)', () => {
  const images = [makeUploaded(1, 'https://blob.example/1.jpg'), makeUploaded(2, 'https://blob.example/2.jpg')];
  // Fallback slot pitch (no real onLayout measurement) is THUMBNAIL_SIZE + THUMBNAIL_GAP = 98,
  // giving slot0 center 49 / slot1 center 147 for a 2-slot track at trackWidth=300 (see
  // twoSlotDrag.ts's computeSlotPitch/slotCenterX) - a large dx safely crosses either way, a small
  // one safely doesn't.
  const TRACK_WIDTH = 300;
  const CROSSING_DX = 200;
  const NON_CROSSING_DX = 5;

  let panResponderSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.useFakeTimers();
    panResponderSpy = stubPanResponderCreate();
  });

  afterEach(() => {
    panResponderSpy.mockRestore();
    jest.useRealTimers();
  });

  it('crossing the other photo\'s center calls onReorder exactly once, with the correct [from, to]', () => {
    const onReorder = jest.fn();
    const renderer = renderPhotoListEditor({ images, onReorder });
    fireTrackLayout(renderer, TRACK_WIDTH);

    dragAndRelease(renderer, 0, CROSSING_DX);

    expect(onReorder).toHaveBeenCalledTimes(1);
    expect(onReorder).toHaveBeenCalledWith(0, 1);
  });

  it('never crossing the other photo\'s center calls onReorder 0 times', () => {
    const onReorder = jest.fn();
    const renderer = renderPhotoListEditor({ images, onReorder });
    fireTrackLayout(renderer, TRACK_WIDTH);

    dragAndRelease(renderer, 0, NON_CROSSING_DX);

    expect(onReorder).not.toHaveBeenCalled();
  });

  it('dragging slot 0 past slot 1 (A -> B) reports [0, 1]', () => {
    const onReorder = jest.fn();
    const renderer = renderPhotoListEditor({ images, onReorder });
    fireTrackLayout(renderer, TRACK_WIDTH);

    dragAndRelease(renderer, 0, CROSSING_DX);

    expect(onReorder).toHaveBeenCalledWith(0, 1);
  });

  it('dragging slot 1 past slot 0 (B -> A) reports [1, 0]', () => {
    const onReorder = jest.fn();
    const renderer = renderPhotoListEditor({ images, onReorder });
    fireTrackLayout(renderer, TRACK_WIDTH);

    dragAndRelease(renderer, 1, -CROSSING_DX);

    expect(onReorder).toHaveBeenCalledWith(1, 0);
  });

  // Regression test for the actual real-device bug: PhotoTrack's responder0/responder1 are built
  // once (useRef(createResponderFor(index)).current - see PhotoListEditor.tsx's own remarks) and
  // must keep calling the LATEST onReorder prop on every release, not the one captured when they
  // were first created - otherwise a second reorder silently reuses stale data from the very first
  // render and can look like it "always reverts" (confirmed via real-device logs: before this fix,
  // a second drag's onReorder call closed over the pre-first-reorder image order and coverImageId,
  // recomputing the same already-current target regardless of drag direction).
  it('a second reorder after the parent re-renders (a new onReorder closure) uses the NEW onReorder, not the one captured at mount', () => {
    const firstOnReorder = jest.fn();
    const renderer = renderPhotoListEditor({ images, onReorder: firstOnReorder });
    fireTrackLayout(renderer, TRACK_WIDTH);

    dragAndRelease(renderer, 0, CROSSING_DX);
    expect(firstOnReorder).toHaveBeenCalledTimes(1);

    // Simulates the parent (ItemDetailsScreen) re-rendering with a brand new onReorder closure -
    // e.g. after setItem() following the first reorder's optimistic update - while `images` itself
    // is left as the caller passed it (PhotoListEditor/PhotoTrack never reorders its own `images`
    // prop locally; the parent is solely responsible for that on the next render).
    const secondOnReorder = jest.fn();
    act(() => {
      renderer.update(
        <PhotoListEditor
          deletingKeys={new Set()}
          images={images}
          isAdding={false}
          onAddPhoto={jest.fn()}
          onDeleteImage={jest.fn()}
          onReorder={secondOnReorder}
        />,
      );
    });

    dragAndRelease(renderer, 0, CROSSING_DX);

    expect(secondOnReorder).toHaveBeenCalledTimes(1);
    expect(secondOnReorder).toHaveBeenCalledWith(0, 1);
    // The stale-closure bug would have called the FIRST render's onReorder again here instead.
    expect(firstOnReorder).toHaveBeenCalledTimes(1);
  });
});
