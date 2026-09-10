import ReactTestRenderer, { act } from 'react-test-renderer';
import { TextInput } from 'react-native';
import i18n from '../../../i18n';
import { QuickSaveComposerScreen } from '../QuickSaveComposerScreen';
import NativeIncomingShare from '../../specs/NativeIncomingShare';

// Pinned to Korean so this file's accessibilityLabel queries (which use the Korean strings
// directly) are deterministic regardless of the react-native-localize jest mock's default locale
// - see other screen tests' identical precedent (e.g. DailyInboxScreen.test.tsx).
beforeAll(async () => {
  await i18n.changeLanguage('ko');
});

jest.mock('../../specs/NativeIncomingShare', () => ({
  __esModule: true,
  default: {
    getPendingShares: jest.fn(),
    getCategorySnapshot: jest.fn(),
    submitQuickSaveDraft: jest.fn(),
    getQuickSaveOutcome: jest.fn(),
    acknowledgePendingShare: jest.fn(),
    finishComposerActivity: jest.fn(),
  },
}));

const PENDING_SHARE_ID = 'share-1';

function makePendingShare(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: PENDING_SHARE_ID,
    text: 'https://www.youtube.com/watch?v=abc',
    receivedAtEpochMs: Date.now(),
    initialTitle: null,
    preselectedCollectionId: null,
    draftTitle: null,
    draftCollectionId: null,
    ...overrides,
  };
}

const CATEGORIES = [
  { id: 1, name: '음식', isFavorite: false },
  { id: 2, name: '영화', isFavorite: true },
];

async function renderComposer(pendingShareOverrides: Partial<Record<string, unknown>> = {}) {
  jest.mocked(NativeIncomingShare!.getPendingShares).mockResolvedValue([
    makePendingShare(pendingShareOverrides),
  ]);
  jest.mocked(NativeIncomingShare!.getCategorySnapshot).mockResolvedValue(CATEGORIES);
  jest.mocked(NativeIncomingShare!.getQuickSaveOutcome).mockResolvedValue('success');

  let renderer!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => {
    renderer = ReactTestRenderer.create(
      <QuickSaveComposerScreen pendingShareId={PENDING_SHARE_ID} />,
    );
  });
  // Flush the initial getPendingShares/getCategorySnapshot Promise.all load.
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
  return renderer;
}

function findByAccessibilityLabel(renderer: ReactTestRenderer.ReactTestRenderer, label: string) {
  return renderer.root.findAll(node => node.props.accessibilityLabel === label)[0];
}

describe('QuickSaveComposerScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('never calls submitQuickSaveDraft before Save is tapped', async () => {
    await renderComposer();
    expect(NativeIncomingShare!.submitQuickSaveDraft).not.toHaveBeenCalled();
  });

  it('sends the edited title as the save payload', async () => {
    const renderer = await renderComposer();

    const titleInput = renderer.root.findByType(TextInput);
    await act(async () => {
      titleInput.props.onChangeText('My custom title');
    });

    await act(async () => {
      findByAccessibilityLabel(renderer, '저장').props.onPress();
    });

    expect(NativeIncomingShare!.submitQuickSaveDraft).toHaveBeenCalledWith(
      PENDING_SHARE_ID,
      'My custom title',
      -1,
    );
  });

  it('preselects the category resolved from a Direct Share shortcut', async () => {
    const renderer = await renderComposer({ preselectedCollectionId: 2 });

    expect(findByAccessibilityLabel(renderer, '영화').props.accessibilityState).toEqual({
      selected: true,
    });
  });

  it('falls back to no category selected when the preselected category no longer exists (stale shortcut)', async () => {
    const renderer = await renderComposer({ preselectedCollectionId: 999 });

    expect(findByAccessibilityLabel(renderer, '선택 안 함').props.accessibilityState).toEqual({
      selected: true,
    });
  });

  it('links the tapped category into the save payload', async () => {
    const renderer = await renderComposer();

    await act(async () => {
      findByAccessibilityLabel(renderer, '음식').props.onPress();
    });
    await act(async () => {
      findByAccessibilityLabel(renderer, '저장').props.onPress();
    });

    expect(NativeIncomingShare!.submitQuickSaveDraft).toHaveBeenCalledWith(
      PENDING_SHARE_ID,
      expect.any(String),
      1,
    );
  });

  it('cancel acknowledges (discards) the pending share and never submits a draft', async () => {
    const renderer = await renderComposer();
    jest.mocked(NativeIncomingShare!.acknowledgePendingShare).mockResolvedValue(undefined);

    await act(async () => {
      findByAccessibilityLabel(renderer, '취소').props.onPress();
    });

    expect(NativeIncomingShare!.acknowledgePendingShare).toHaveBeenCalledWith(PENDING_SHARE_ID);
    expect(NativeIncomingShare!.submitQuickSaveDraft).not.toHaveBeenCalled();
    expect(NativeIncomingShare!.finishComposerActivity).toHaveBeenCalled();
  });

  it('tapping Save twice only submits the draft once', async () => {
    const renderer = await renderComposer();

    await act(async () => {
      const saveButton = findByAccessibilityLabel(renderer, '저장');
      saveButton.props.onPress();
      saveButton.props.onPress();
    });

    expect(NativeIncomingShare!.submitQuickSaveDraft).toHaveBeenCalledTimes(1);
  });
});
