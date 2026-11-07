import ReactTestRenderer, { act } from 'react-test-renderer';
import { LayoutAnimation, Modal, Platform, Text } from 'react-native';
import { PendingActionRow } from '../../components/PendingActionRow';
import i18n from '../../i18n';
import {
  approveCollectionJoinRequest,
  approveCollectionSubmission,
  cancelMySubmission,
  getCollectionSubmissions,
  listCollectionJoinRequests,
  rejectCollectionJoinRequest,
  rejectCollectionSubmission,
} from '../api/collectionsApi';
import { CollectionReviewRequestsSheet, REVIEW_SHEET_SLIDE_MS, type ReviewSheetPage } from '../CollectionReviewRequestsSheet';

jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: ({ children }: { children: React.ReactNode }) => children,
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 24, left: 0 }),
}));
jest.mock('../api/collectionsApi', () => ({
  ...jest.requireActual('../api/collectionsApi'),
  getCollectionSubmissions: jest.fn(),
  listCollectionJoinRequests: jest.fn(),
  approveCollectionSubmission: jest.fn(),
  rejectCollectionSubmission: jest.fn(),
  approveCollectionJoinRequest: jest.fn(),
  rejectCollectionJoinRequest: jest.fn(),
  cancelMySubmission: jest.fn(),
}));

type Renderer = ReactTestRenderer.ReactTestRenderer;
const originalPlatform = Platform.OS;

beforeAll(async () => {
  await i18n.changeLanguage('ko');
});
beforeEach(() => {
  jest.mocked(getCollectionSubmissions).mockResolvedValue({ items: [], nextCursor: null } as never);
  jest.mocked(listCollectionJoinRequests).mockResolvedValue([]);
});
afterEach(() => {
  Platform.OS = originalPlatform;
  jest.clearAllMocks();
});

interface Options {
  readonly approvalCount?: number;
  readonly joinCount?: number;
  readonly initialPage?: ReviewSheetPage;
  readonly onBeforeOpenList?: (open: () => void) => void;
}

async function render({ approvalCount = 3, joinCount = 2, initialPage, onBeforeOpenList }: Options = {}) {
  const onClose = jest.fn();
  const onChanged = jest.fn();
  let renderer!: Renderer;
  await act(async () => {
    renderer = ReactTestRenderer.create(
      <CollectionReviewRequestsSheet
        approvalCount={approvalCount}
        authenticatedRequest={jest.fn() as never}
        collectionId={5}
        initialPage={initialPage}
        joinCount={joinCount}
        onBeforeOpenList={onBeforeOpenList}
        onChanged={onChanged}
        onClose={onClose}
        visible
      />,
    );
  });
  return { renderer, onClose, onChanged };
}

const byId = (renderer: Renderer, testID: string) => renderer.root.findAll(node => node.props.testID === testID && typeof node.props.onPress === 'function')[0];
const exists = (renderer: Renderer, testID: string) => renderer.root.findAll(node => node.props.testID === testID).length > 0;
const title = (renderer: Renderer) => String(renderer.root.findAll(node => node.type === Text && typeof node.props.testID === 'string' && node.props.testID.includes('title'))[0].props.children);
const visibleModals = (renderer: Renderer) => renderer.root.findAllByType(Modal).filter(modal => modal.props.visible === true);
const settle = async () => {
  await act(async () => {
    await new Promise<void>(resolve => { setTimeout(resolve, REVIEW_SHEET_SLIDE_MS + 150); });
  });
};

describe('검토할 요청: one sheet, pages inside it', () => {
  it('opens on the type chooser with each positive count, in ONE native Modal', async () => {
    const { renderer } = await render();
    const rows = renderer.root.findAllByType(PendingActionRow);
    expect(rows.map(row => row.findAllByType(Text).map(text => text.props.children))).toEqual([['받은 승인 요청', '대기 3건'], ['참여 요청', '대기 2건']]);
    expect(title(renderer)).toBe('검토할 요청');
    expect(visibleModals(renderer)).toHaveLength(1);
    expect(exists(renderer, 'collection-review-back')).toBe(false);
    act(() => renderer.unmount());
  });

  it('choosing a type slides its list in INSIDE the same sheet - no second sheet is raised', async () => {
    const { renderer } = await render();
    await act(async () => byId(renderer, 'collection-review-approvals').props.onPress());

    expect(visibleModals(renderer)).toHaveLength(1);
    expect(exists(renderer, 'collection-review-page-approvals')).toBe(true);
    expect(title(renderer)).toBe('받은 승인 요청');
    expect(exists(renderer, 'collection-review-back')).toBe(true);
    // Once the slide is over only the list is on screen.
    await settle();
    expect(exists(renderer, 'collection-review-types')).toBe(false);
    act(() => renderer.unmount());
  });

  it('the slide is a short layout-animated motion of about a quarter second', async () => {
    const configure = jest.spyOn(LayoutAnimation, 'configureNext');
    expect(REVIEW_SHEET_SLIDE_MS).toBeGreaterThanOrEqual(220);
    expect(REVIEW_SHEET_SLIDE_MS).toBeLessThanOrEqual(280);
    const { renderer } = await render();
    await act(async () => byId(renderer, 'collection-review-join').props.onPress());
    expect(configure).toHaveBeenCalled();
    configure.mockRestore();
    act(() => renderer.unmount());
  });

  it('the back arrow returns to the chooser (and the system back button does the same first); only then does back close', async () => {
    const { renderer, onClose } = await render();
    await act(async () => byId(renderer, 'collection-review-join').props.onPress());
    await settle();

    const modal = visibleModals(renderer)[0];
    await act(async () => modal.props.onRequestClose());
    expect(onClose).not.toHaveBeenCalled();
    expect(title(renderer)).toBe('검토할 요청');
    await settle();
    expect(exists(renderer, 'collection-review-page-types')).toBe(true);

    await act(async () => byId(renderer, 'collection-review-join').props.onPress());
    await settle();
    await act(async () => byId(renderer, 'collection-review-back').props.onPress());
    expect(title(renderer)).toBe('검토할 요청');
    await settle();

    await act(async () => visibleModals(renderer)[0].props.onRequestClose());
    expect(onClose).toHaveBeenCalledTimes(1);
    act(() => renderer.unmount());
  });

  it('the X and the backdrop only close the sheet - from the chooser and from a list - and never answer, approve or cancel anything', async () => {
    const { renderer, onClose } = await render();
    await act(async () => byId(renderer, 'collection-review-approvals').props.onPress());
    await settle();
    const backdrop = renderer.root.findAll(node => node.props.importantForAccessibility === 'no-hide-descendants' && typeof node.props.onPress === 'function')[0];
    await act(async () => backdrop.props.onPress());
    await act(async () => byId(renderer, 'collection-review-close').props.onPress());
    expect(onClose).toHaveBeenCalledTimes(2);
    for (const mutation of [approveCollectionSubmission, rejectCollectionSubmission, approveCollectionJoinRequest, rejectCollectionJoinRequest, cancelMySubmission]) {
      expect(mutation).not.toHaveBeenCalled();
    }
    act(() => renderer.unmount());
  });

  it('a notification can open straight on a list, which still steps back to the chooser', async () => {
    const { renderer } = await render({ initialPage: 'join' });
    expect(title(renderer)).toBe('참여 요청');
    expect(listCollectionJoinRequests).toHaveBeenCalled();
    expect(getCollectionSubmissions).not.toHaveBeenCalled();
    await act(async () => byId(renderer, 'collection-review-back').props.onPress());
    expect(title(renderer)).toBe('검토할 요청');
    act(() => renderer.unmount());
  });

  it('a list loads only when its page is shown', async () => {
    const { renderer } = await render();
    expect(getCollectionSubmissions).not.toHaveBeenCalled();
    expect(listCollectionJoinRequests).not.toHaveBeenCalled();
    await act(async () => byId(renderer, 'collection-review-approvals').props.onPress());
    expect(getCollectionSubmissions).toHaveBeenCalled();
    expect(listCollectionJoinRequests).not.toHaveBeenCalled();
    act(() => renderer.unmount());
  });

  it('a locked Collection asks for its password BEFORE the list opens (the list waits for the gate)', async () => {
    let release: (() => void) | undefined;
    const { renderer } = await render({ onBeforeOpenList: open => { release = open; } });
    await act(async () => byId(renderer, 'collection-review-approvals').props.onPress());
    expect(title(renderer)).toBe('검토할 요청');
    expect(getCollectionSubmissions).not.toHaveBeenCalled();
    await act(async () => release!());
    expect(title(renderer)).toBe('받은 승인 요청');
    act(() => renderer.unmount());
  });

  it('empty types are not offered', async () => {
    const { renderer } = await render({ approvalCount: 2, joinCount: 0 });
    expect(exists(renderer, 'collection-review-join')).toBe(false);
    expect(exists(renderer, 'collection-review-approvals')).toBe(true);
    act(() => renderer.unmount());
  });
});
