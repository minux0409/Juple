import ReactTestRenderer, { act } from 'react-test-renderer';
import { Image, Text } from 'react-native';
import i18n from '../../i18n';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { PhotoListEditor } from '../PhotoListEditor';
import type { EffectiveImage } from '../../items/effectiveImages';

beforeAll(async () => {
  await i18n.changeLanguage('ko');
});

function makeUploaded(id: number, readUrl: string): EffectiveImage {
  return { kind: 'uploaded', image: { id, contentType: 'image/jpeg', byteLength: 1, sortOrder: 0, createdAtUtc: '', readUrl } };
}

interface RenderOverrides {
  readonly deletingKeys?: ReadonlySet<string>;
  readonly images?: readonly EffectiveImage[];
  readonly isAdding?: boolean;
  readonly onAddPhoto?: () => void;
  readonly onDeleteImage?: (image: EffectiveImage) => void;
  readonly onSetRepresentative?: (index: number) => void;
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
        onSetRepresentative={overrides.onSetRepresentative ?? jest.fn()}
      />,
    );
  });
  return renderer;
}

// react-test-renderer's tree includes both a composite component instance and its underlying
// host instance for the same logical element, and both often carry the same props (e.g. a
// composite Pressable and its rendered host View both expose the accessibilityLabel it was
// given). Requiring `onPress` to actually be a function isolates the one real interactive
// Pressable instance, exactly like this file's own delete-button lookups already do below.
function findPressableByAccessibilityLabel(renderer: ReactTestRenderer.ReactTestRenderer, label: string) {
  return renderer.root.findAll(
    node => node.props.accessibilityLabel === label && typeof node.props.onPress === 'function',
  )[0];
}

function findAllPressablesByAccessibilityLabel(renderer: ReactTestRenderer.ReactTestRenderer, label: string) {
  return renderer.root.findAll(
    node => node.props.accessibilityLabel === label && typeof node.props.onPress === 'function',
  );
}

function findByAccessibilityLabel(renderer: ReactTestRenderer.ReactTestRenderer, label: string) {
  return renderer.root.findAll(node => node.props.accessibilityLabel === label)[0];
}

function findVisibleConfirmDialog(renderer: ReactTestRenderer.ReactTestRenderer) {
  return renderer.root.findAll(node => node.type === ConfirmDialog && node.props.visible === true)[0];
}

/** Every rendered representative-badge Text - filtered to the composite `Text` component itself
 * (not its underlying host instance, which duplicates the same `children` prop). */
function findRepresentativeBadges(renderer: ReactTestRenderer.ReactTestRenderer) {
  return renderer.root.findAll(node => node.type === Text && node.props.children === '대표');
}

/** Taps the 2nd (non-representative) photo - the only photo PhotoListEditor ever wires a press
 * handler to (see PhotoThumbnail's own remarks: the representative photo is a plain, non-
 * interactive View). This opens the confirm dialog; it does not by itself call
 * onSetRepresentative. */
function tapSecondPhoto(renderer: ReactTestRenderer.ReactTestRenderer) {
  act(() => {
    findPressableByAccessibilityLabel(renderer, i18n.t('item.setAsFirstPhotoA11y'))?.props.onPress();
  });
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

  it('renders one thumbnail, automatically shown as the representative', () => {
    const renderer = renderPhotoListEditor({ images });

    expect(renderer.root.findAllByType(Image)).toHaveLength(1);
    expect(findRepresentativeBadges(renderer)).toHaveLength(1);
    expect(findByAccessibilityLabel(renderer, '대표 이미지')).toBeTruthy();
  });

  it('tapping the single (representative) photo does nothing - no dialog, no callback', () => {
    const onSetRepresentative = jest.fn();
    const renderer = renderPhotoListEditor({ images, onSetRepresentative });

    // The representative photo is a plain View, not a Pressable - there is no "첫 번째로 설정"
    // labeled element to tap at all for a 1-photo list.
    expect(findByAccessibilityLabel(renderer, i18n.t('item.setAsFirstPhotoA11y'))).toBeUndefined();
    expect(findVisibleConfirmDialog(renderer)).toBeFalsy();
    expect(onSetRepresentative).not.toHaveBeenCalled();
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

describe('PhotoListEditor - 2 photos (tap + confirm to change representative)', () => {
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

  it('only the first photo shows the representative badge', () => {
    const renderer = renderPhotoListEditor({ images });

    expect(findRepresentativeBadges(renderer)).toHaveLength(1);
    expect(renderer.root.findAll(node => node.props.accessibilityLabel === '대표 이미지')).not.toHaveLength(0);
  });

  it('tapping the first (representative) photo does nothing - no dialog, no callback', () => {
    const onSetRepresentative = jest.fn();
    const renderer = renderPhotoListEditor({ images, onSetRepresentative });

    // Only ONE real Pressable carries the "첫 번째로 설정" label (the 2nd photo) - the
    // representative photo is a plain View, never wired to onPress at all.
    expect(findAllPressablesByAccessibilityLabel(renderer, i18n.t('item.setAsFirstPhotoA11y'))).toHaveLength(1);
    expect(findVisibleConfirmDialog(renderer)).toBeFalsy();
    expect(onSetRepresentative).not.toHaveBeenCalled();
  });

  it('tapping the second photo shows the confirm dialog, without calling onSetRepresentative yet', () => {
    const onSetRepresentative = jest.fn();
    const renderer = renderPhotoListEditor({ images, onSetRepresentative });

    tapSecondPhoto(renderer);

    const dialog = findVisibleConfirmDialog(renderer);
    expect(dialog).toBeTruthy();
    expect(dialog.props.title).toBe(i18n.t('item.setRepresentativeConfirmTitle'));
    expect(dialog.props.message).toBe(i18n.t('item.setRepresentativeConfirmMessage'));
    expect(dialog.props.confirmLabel).toBe(i18n.t('item.setRepresentativeConfirm'));
    expect(onSetRepresentative).not.toHaveBeenCalled();
  });

  it('cancelling the dialog closes it and never calls onSetRepresentative', () => {
    const onSetRepresentative = jest.fn();
    const renderer = renderPhotoListEditor({ images, onSetRepresentative });

    tapSecondPhoto(renderer);
    act(() => {
      findVisibleConfirmDialog(renderer).props.onCancel();
    });

    expect(findVisibleConfirmDialog(renderer)).toBeFalsy();
    expect(onSetRepresentative).not.toHaveBeenCalled();
  });

  it('confirming calls onSetRepresentative exactly once, with the tapped photo\'s index', () => {
    const onSetRepresentative = jest.fn();
    const renderer = renderPhotoListEditor({ images, onSetRepresentative });

    tapSecondPhoto(renderer);
    act(() => {
      findVisibleConfirmDialog(renderer).props.onConfirm();
    });

    expect(onSetRepresentative).toHaveBeenCalledTimes(1);
    expect(onSetRepresentative).toHaveBeenCalledWith(1);
    expect(findVisibleConfirmDialog(renderer)).toBeFalsy();
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

  it('re-rendering with only 1 remaining photo after a delete drops back to the single, non-tappable layout', () => {
    const renderer = renderPhotoListEditor({ images });

    act(() => {
      renderer.update(
        <PhotoListEditor
          deletingKeys={new Set()}
          images={[images[0]]}
          isAdding={false}
          onAddPhoto={jest.fn()}
          onDeleteImage={jest.fn()}
          onSetRepresentative={jest.fn()}
        />,
      );
    });

    expect(renderer.root.findAllByType(Image)).toHaveLength(1);
    expect(findByAccessibilityLabel(renderer, i18n.t('item.setAsFirstPhotoA11y'))).toBeUndefined();
  });

  it('a second confirmed selection after the parent re-renders (a new onSetRepresentative closure) uses the NEW callback', () => {
    const firstOnSetRepresentative = jest.fn();
    const renderer = renderPhotoListEditor({ images, onSetRepresentative: firstOnSetRepresentative });

    tapSecondPhoto(renderer);
    act(() => {
      findVisibleConfirmDialog(renderer).props.onConfirm();
    });
    expect(firstOnSetRepresentative).toHaveBeenCalledTimes(1);

    // Simulates the parent (ItemDetailsScreen) re-rendering with a brand new callback closure and
    // the (now server-confirmed) swapped order - PhotoListEditor never reorders `images` itself,
    // the parent always owns that.
    const secondOnSetRepresentative = jest.fn();
    act(() => {
      renderer.update(
        <PhotoListEditor
          deletingKeys={new Set()}
          images={[images[1], images[0]]}
          isAdding={false}
          onAddPhoto={jest.fn()}
          onDeleteImage={jest.fn()}
          onSetRepresentative={secondOnSetRepresentative}
        />,
      );
    });

    tapSecondPhoto(renderer);
    act(() => {
      findVisibleConfirmDialog(renderer).props.onConfirm();
    });

    expect(secondOnSetRepresentative).toHaveBeenCalledTimes(1);
    expect(secondOnSetRepresentative).toHaveBeenCalledWith(1);
    expect(firstOnSetRepresentative).toHaveBeenCalledTimes(1);
  });
});
