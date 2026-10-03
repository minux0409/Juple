import ReactTestRenderer, { act } from 'react-test-renderer';
import { FlatList, Image, Linking, StyleSheet, Text } from 'react-native';
import { CheckIcon } from '../../icons/CheckIcon';
import { CloseIcon } from '../../icons/CloseIcon';
import { ExternalLinkIcon } from '../../icons/ExternalLinkIcon';
import { FolderIcon } from '../../icons/FolderIcon';
import { ShareIcon } from '../../icons/ShareIcon';
import { TrashIcon } from '../../icons/TrashIcon';
import { PENDING_SUBMISSION_THUMBNAIL_SIZE } from '../PendingSubmissionCard';
import { SwipeableItemRow } from '../../components/SwipeableItemRow';
import { closeOpenRow } from '../../components/swipeableRowCoordinator';
import i18n from '../../i18n';
import { ApiError } from '../../api/ApiError';
import { AppToastProvider } from '../../components/AppToast';
import { BottomSheetModal } from '../../components/BottomSheetModal';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { UserAvatar } from '../../components/UserAvatar';
import { ApprovalSubmissionSheet } from '../ApprovalSubmissionSheet';
import {
  approveCollectionSubmission,
  cancelMySubmission,
  getCollectionSubmissions,
  getMyCollectionSubmissions,
  getMyPendingSubmissionsAcrossCollections,
  rejectCollectionSubmission,
  type CollectionLinkSubmission,
  type MyCollectionLinkSubmissionWithCollection,
} from '../api/collectionsApi';
import { emitSocialPushEvent } from '../../push/pushEvents';
import { markCollectionSubmissionRequestsRead } from '../../notifications/notificationsApi';
import { getUnreadCount, resetNotificationState } from '../../notifications/notificationState';

jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: ({ children }: { children: React.ReactNode }) => children,
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));
jest.mock('../../notifications/notificationsApi', () => ({
  ...jest.requireActual('../../notifications/notificationsApi'),
  markCollectionSubmissionRequestsRead: jest.fn().mockResolvedValue({ markedCount: 1, unreadCount: 2 }),
}));
jest.mock('../api/collectionsApi', () => ({
  getCollectionSubmissions: jest.fn(),
  getMyCollectionSubmissions: jest.fn(),
  getMyPendingSubmissionsAcrossCollections: jest.fn(),
  approveCollectionSubmission: jest.fn(),
  rejectCollectionSubmission: jest.fn(),
  cancelMySubmission: jest.fn(),
}));

beforeAll(async () => {
  await i18n.changeLanguage('ko');
});

// SwipeableItemRow mounts its revealed actions once a horizontal drag is recognized (its own responder grant) -
// the same call the real gesture system makes. The horizontal-vs-vertical arbitration itself is the shared
// component's (tested in SwipeableItemRow.test), not duplicated here.
const FAKE_RESPONDER_EVENT = {
  touchHistory: { touchBank: [], numberActiveTouches: 0, indexOfSingleActiveTouch: -1, mostRecentTimeStamp: 0 },
  nativeEvent: {},
};
const swipeRows = (renderer: ReactTestRenderer.ReactTestRenderer) => renderer.root.findAllByType(SwipeableItemRow);
const swipeRowOf = (renderer: ReactTestRenderer.ReactTestRenderer, id: number) =>
  swipeRows(renderer).find(row => row.props.deleteTestID === `submission-cancel-${id}`)!;
/** Swipes the request card left: reveals the red cancel action (it does not cancel anything). */
const reveal = async (renderer: ReactTestRenderer.ReactTestRenderer, id: number) => {
  const layer = swipeRowOf(renderer, id).findAll(node => Array.isArray(node.props.accessibilityActions))[0];
  await act(async () => {
    layer.props.onResponderGrant(FAKE_RESPONDER_EVENT);
  });
};

const mounted: ReactTestRenderer.ReactTestRenderer[] = [];
afterEach(() => {
  // A sheet listens for Push refresh signals while mounted: none may outlive its test.
  act(() => {
    mounted.splice(0).forEach(renderer => renderer.unmount());
  });
  jest.clearAllMocks();
});

const byMember: CollectionLinkSubmission = {
  submissionId: 11,
  url: 'https://example.com/a',
  title: 'Member idea',
  previewImageUrl: 'https://cdn.example/a.jpg',
  submittedAtUtc: '2026-10-01T00:00:00Z',
  viaPublicShare: false,
  proposer: { kind: 'member', jupleId: 'MMBR2345', displayName: '꼬부기', profileImageUrl: 'https://blob.example/m.jpg', profileImageVersion: 'v1' },
};
const viaPublicLink: CollectionLinkSubmission = {
  submissionId: 12,
  url: 'https://news.example.org/b',
  title: null,
  previewImageUrl: null,
  submittedAtUtc: '2026-10-01T01:00:00Z',
  viaPublicShare: true,
  proposer: null,
};
const mine = (id: number, collectionName: string, title: string | null = `Link ${id}`): MyCollectionLinkSubmissionWithCollection => ({
  submissionId: id,
  collectionId: id * 10,
  collectionName,
  url: `https://example.com/${id}`,
  title,
  previewImageUrl: null,
  submittedAtUtc: '2026-10-01T00:00:00Z',
});

interface SheetProps {
  readonly variant: 'owner' | 'mine';
  readonly collectionId: number | null;
  readonly onClose?: () => void;
  readonly onChanged?: () => void;
  readonly onTotalLoaded?: (total: number) => void;
  readonly visible?: boolean;
  readonly expectedCount?: number;
}

async function renderSheet(props: SheetProps) {
  const onClose = props.onClose ?? jest.fn();
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => {
    renderer = ReactTestRenderer.create(
      <AppToastProvider>
        <ApprovalSubmissionSheet
          authenticatedRequest={jest.fn()}
          collectionId={props.collectionId}
          expectedCount={props.expectedCount}
          onChanged={props.onChanged}
          onClose={onClose}
          onTotalLoaded={props.onTotalLoaded}
          variant={props.variant}
          visible={props.visible ?? true}
        />
      </AppToastProvider>,
    );
  });
  mounted.push(renderer);
  return { renderer, onClose };
}

const press = async (renderer: ReactTestRenderer.ReactTestRenderer, testID: string) => {
  const target = renderer.root.findAll(node => node.props.testID === testID && typeof node.props.onPress === 'function')[0];
  await act(async () => {
    await target.props.onPress();
  });
};
/** The Owner's check asks first: tap it, then confirm the common dialog. */
const approveOwner = async (renderer: ReactTestRenderer.ReactTestRenderer, id: number) => {
  await act(async () => {
    renderer.root.find(node => node.props.testID === `submission-approve-${id}` && typeof node.props.onPress === 'function').props.onPress();
  });
  await act(async () => {
    renderer.root.findAllByType(ConfirmDialog).find(dialog => dialog.props.title === '이 링크 요청을 승인할까요?' && dialog.props.visible)!.props.onConfirm();
  });
};
const exists = (renderer: ReactTestRenderer.ReactTestRenderer, testID: string) =>
  renderer.root.findAll(node => node.props.testID === testID).length > 0;
const shown = (renderer: ReactTestRenderer.ReactTestRenderer) => renderer.root.findAllByType(Text).map(node => node.props.children);

describe('ApprovalSubmissionSheet - the Owner\'s 링크 승인 대기 popup', () => {
  it('is a bottom sheet (not a screen) titled 승인 요청, listing each proposal with preview, title, site and proposer - a public-link proposer is never named', async () => {
    jest.mocked(getCollectionSubmissions).mockResolvedValue({ items: [byMember, viaPublicLink], nextCursor: null });
    const { renderer } = await renderSheet({ variant: 'owner', collectionId: 5 });

    expect(renderer.root.findAllByType(BottomSheetModal)).toHaveLength(1);
    expect(shown(renderer)).toContain('받은 승인 요청');
    expect(getCollectionSubmissions).toHaveBeenCalledWith(expect.anything(), 5, null);
    const memberRow = renderer.root.findAll(node => node.props.testID === 'submission-11')[0];
    expect(memberRow.findAll(node => node.type === Image && node.props.testID === 'submission-thumbnail-11')[0].props.source).toEqual({ uri: 'https://cdn.example/a.jpg' });
    expect(memberRow.findByType(UserAvatar).props).toEqual(expect.objectContaining({ jupleId: 'MMBR2345', imageUrl: 'https://blob.example/m.jpg' }));
    expect(JSON.stringify(shown(renderer))).toContain('Member idea');
    expect(JSON.stringify(shown(renderer))).toContain('example.com');
    expect(JSON.stringify(shown(renderer))).toContain('꼬부기');

    const publicRow = renderer.root.findAll(node => node.props.testID === 'submission-12')[0];
    expect(publicRow.findAllByType(UserAvatar)).toHaveLength(0);
    expect(JSON.stringify(publicRow.findAllByType(Text).map(node => node.props.children))).toContain('공개 링크로 제안됨');
    // No title: the site stands in for it. And never the Collection name in the Owner's own queue.
    expect(JSON.stringify(publicRow.findAllByType(Text).map(node => node.props.children))).toContain('news.example.org');
    expect(JSON.stringify(shown(renderer))).not.toContain('에서 승인 대기 중');
  });

  it('opening it reads the 승인 요청 notifications (the requests themselves still wait); a failed load reads nothing', async () => {
    resetNotificationState();
    jest.mocked(getCollectionSubmissions).mockResolvedValueOnce({ items: [byMember], nextCursor: null });
    await renderSheet({ variant: 'owner', collectionId: 5 });

    expect(markCollectionSubmissionRequestsRead).toHaveBeenCalledWith(expect.any(Function), 5);
    expect(getUnreadCount()).toBe(2);
    expect(approveCollectionSubmission).not.toHaveBeenCalled();
    expect(rejectCollectionSubmission).not.toHaveBeenCalled();

    jest.mocked(markCollectionSubmissionRequestsRead).mockClear();
    jest.mocked(getCollectionSubmissions).mockRejectedValueOnce(new ApiError('forbidden', 403, 'collectionLocked'));
    await renderSheet({ variant: 'owner', collectionId: 5 });
    expect(markCollectionSubmissionRequestsRead).not.toHaveBeenCalled();
  });

  it('a closed sheet loads nothing', async () => {
    await renderSheet({ variant: 'owner', collectionId: 5, visible: false });
    expect(getCollectionSubmissions).not.toHaveBeenCalled();
  });

  it('승인 adds it, the row leaves at once (no reload) and the caller is told so it can refresh its count and content', async () => {
    jest.mocked(getCollectionSubmissions).mockResolvedValue({ items: [byMember, viaPublicLink], nextCursor: null });
    jest.mocked(approveCollectionSubmission).mockResolvedValue(undefined);
    const onChanged = jest.fn();
    const { renderer, onClose } = await renderSheet({ variant: 'owner', collectionId: 5, onChanged });

    await approveOwner(renderer, 11);

    expect(approveCollectionSubmission).toHaveBeenCalledWith(expect.anything(), 5, 11);
    expect(exists(renderer, 'submission-11')).toBe(false);
    expect(exists(renderer, 'submission-12')).toBe(true);
    expect(onChanged).toHaveBeenCalledTimes(1);
    expect(getCollectionSubmissions).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('answering the last one closes the sheet (nothing left to say) after telling the caller', async () => {
    jest.mocked(getCollectionSubmissions).mockResolvedValue({ items: [byMember], nextCursor: null });
    jest.mocked(approveCollectionSubmission).mockResolvedValue(undefined);
    const onChanged = jest.fn();
    const { renderer, onClose } = await renderSheet({ variant: 'owner', collectionId: 5, onChanged });

    await approveOwner(renderer, 11);

    expect(onChanged).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('거절 asks first, then drops it - nothing is added', async () => {
    jest.mocked(getCollectionSubmissions).mockResolvedValue({ items: [byMember, viaPublicLink], nextCursor: null });
    jest.mocked(rejectCollectionSubmission).mockResolvedValue(undefined);
    const onChanged = jest.fn();
    const { renderer } = await renderSheet({ variant: 'owner', collectionId: 5, onChanged });

    await press(renderer, 'submission-reject-11');
    expect(rejectCollectionSubmission).not.toHaveBeenCalled();
    const confirm = renderer.root.findAllByType(ConfirmDialog).find(dialog => dialog.props.visible)!;
    expect(confirm.props.title).toBe('이 링크 요청을 거절할까요?');
    await act(async () => {
      confirm.props.onConfirm();
    });

    expect(rejectCollectionSubmission).toHaveBeenCalledWith(expect.anything(), 5, 11);
    expect(approveCollectionSubmission).not.toHaveBeenCalled();
    expect(exists(renderer, 'submission-11')).toBe(false);
    expect(onChanged).toHaveBeenCalledTimes(1);
  });

  it('already handled elsewhere, or no longer addable: the row leaves and says why; a plain failure keeps it', async () => {
    jest.mocked(getCollectionSubmissions).mockResolvedValue({ items: [byMember, viaPublicLink, { ...byMember, submissionId: 13 }, { ...byMember, submissionId: 14 }], nextCursor: null });
    jest.mocked(approveCollectionSubmission)
      .mockRejectedValueOnce(new ApiError('notFound', 404))
      .mockRejectedValueOnce(new ApiError('conflict', 409, 'linkAlreadyInCollection'))
      .mockRejectedValueOnce(new Error('offline'));
    const { renderer } = await renderSheet({ variant: 'owner', collectionId: 5 });

    await approveOwner(renderer, 11);
    expect(exists(renderer, 'submission-11')).toBe(false);
    await approveOwner(renderer, 12);
    expect(exists(renderer, 'submission-12')).toBe(false);
    expect(shown(renderer)).toContain('이미 컬렉션에 있는 링크예요.');
    await approveOwner(renderer, 13);
    expect(exists(renderer, 'submission-13')).toBe(true);
    expect(shown(renderer)).toContain(i18n.t('submissions.actionError'));
  });

  it('pages: the next page is appended, never duplicated', async () => {
    jest.mocked(getCollectionSubmissions)
      .mockResolvedValueOnce({ items: [byMember], nextCursor: 11 })
      .mockResolvedValueOnce({ items: [byMember, viaPublicLink], nextCursor: null });
    const { renderer } = await renderSheet({ variant: 'owner', collectionId: 5 });
    await act(async () => {
      renderer.root.findByType(FlatList).props.onEndReached();
    });

    expect(getCollectionSubmissions).toHaveBeenLastCalledWith(expect.anything(), 5, 11);
    expect((renderer.root.findByType(FlatList).props.data as { submissionId: number }[]).map(entry => entry.submissionId)).toEqual([11, 12]);
  });

  it('nothing waiting: a compact empty state', async () => {
    jest.mocked(getCollectionSubmissions).mockResolvedValue({ items: [], nextCursor: null });
    const { renderer } = await renderSheet({ variant: 'owner', collectionId: 5 });

    expect(shown(renderer)).toContain('받은 승인 요청이 없어요.');
  });

  it('the first frame holds skeleton cards in the final geometry, never an empty white panel, until the rows arrive', async () => {
    let resolve!: (page: { items: CollectionLinkSubmission[]; nextCursor: null }) => void;
    jest.mocked(getCollectionSubmissions).mockReturnValue(new Promise(done => { resolve = done; }));
    const { renderer } = await renderSheet({ variant: 'owner', collectionId: 5, expectedCount: 2 });

    expect(exists(renderer, 'approval-sheet-skeleton')).toBe(true);
    expect(renderer.root.findAll(node => node.props.testID === 'approval-sheet-skeleton')[0].findAll(node => typeof node.type === 'string' && node.props.accessibilityElementsHidden === true).length).toBe(2);
    await act(async () => {
      resolve({ items: [byMember], nextCursor: null });
    });
    expect(exists(renderer, 'approval-sheet-skeleton')).toBe(false);
    expect(exists(renderer, 'submission-11')).toBe(true);
  });
});

describe('ApprovalSubmissionSheet - 내 링크 승인 대기 (my own, view only)', () => {
  it('across all my member Collections: each link says which Collection it waits in, newest first, nothing to act on', async () => {
    jest.mocked(getMyPendingSubmissionsAcrossCollections).mockResolvedValue({
      items: [mine(13, '위시리스트'), mine(12, '여행', null)],
      nextCursor: null,
      totalCount: 2,
    });
    const onTotalLoaded = jest.fn();
    const { renderer } = await renderSheet({ variant: 'mine', collectionId: null, onTotalLoaded });

    expect(getMyPendingSubmissionsAcrossCollections).toHaveBeenCalledWith(expect.anything(), null);
    expect(getMyCollectionSubmissions).not.toHaveBeenCalled();
    expect(shown(renderer)).toContain('보낸 승인 요청');
    // One compact context line per card - [folder] Collection · relative time - and NO "승인 대기 중" line (the sheet title says it).
    expect(shown(renderer)).toEqual(expect.arrayContaining(['Link 13', '위시리스트', '여행']));
    expect(shown(renderer).some(text => typeof text === 'string' && text.includes('승인 대기 중'))).toBe(false);
    const context = renderer.root.find(node => node.props.testID === 'my-submission-context-13');
    expect(context.findAllByType(FolderIcon)).toHaveLength(1);
    // No title: the site stands in for it.
    expect(shown(renderer)).toContain('example.com');
    expect(renderer.root.findAll(node => node.props.testID === 'submission-approve-13')).toHaveLength(0);
    expect(renderer.root.findAll(node => node.props.testID === 'submission-reject-13')).toHaveLength(0);
    expect(onTotalLoaded).toHaveBeenCalledWith(2);
    expect(renderer.root.findByProps({ testID: 'my-submission-info-13' }).props.accessibilityLabel).toContain('위시리스트');
    expect(markCollectionSubmissionRequestsRead).not.toHaveBeenCalled();
  });

  it('scoped to one Collection: the same popup, that Collection\'s own links, the plain 승인 대기 중 status', async () => {
    jest.mocked(getMyCollectionSubmissions).mockResolvedValue({
      items: [{ submissionId: 21, url: 'https://example.com/21', title: 'Mine here', previewImageUrl: null, submittedAtUtc: '2026-10-01T00:00:00Z' }],
      nextCursor: null,
      totalCount: 1,
    });
    const { renderer } = await renderSheet({ variant: 'mine', collectionId: 5 });

    expect(getMyCollectionSubmissions).toHaveBeenCalledWith(expect.anything(), 5, null);
    expect(getMyPendingSubmissionsAcrossCollections).not.toHaveBeenCalled();
    expect(shown(renderer)).toContain('Mine here');
    // Scoped to one Collection: no Collection needs saying and nothing says "waiting" - just the time.
    expect(shown(renderer).some(text => typeof text === 'string' && text.includes('승인 대기 중'))).toBe(false);
    expect(renderer.root.findAllByType(FolderIcon)).toHaveLength(0);
  });

  it('pages: the next page is appended through the aggregate endpoint, never duplicated', async () => {
    jest.mocked(getMyPendingSubmissionsAcrossCollections)
      .mockResolvedValueOnce({ items: [mine(13, 'A'), mine(12, 'B')], nextCursor: 12, totalCount: 3 })
      .mockResolvedValueOnce({ items: [mine(12, 'B'), mine(11, 'C')], nextCursor: null, totalCount: 3 });
    const { renderer } = await renderSheet({ variant: 'mine', collectionId: null });
    await act(async () => {
      renderer.root.findByType(FlatList).props.onEndReached();
    });

    expect(getMyPendingSubmissionsAcrossCollections).toHaveBeenLastCalledWith(expect.anything(), 12);
    expect((renderer.root.findByType(FlatList).props.data as { submissionId: number }[]).map(entry => entry.submissionId)).toEqual([13, 12, 11]);
  });

  it('empty and failed loads are said inside the sheet', async () => {
    jest.mocked(getMyPendingSubmissionsAcrossCollections).mockResolvedValue({ items: [], nextCursor: null, totalCount: 0 });
    expect(shown((await renderSheet({ variant: 'mine', collectionId: null })).renderer)).toContain(i18n.t('submissions.myEmpty'));

    jest.mocked(getMyPendingSubmissionsAcrossCollections).mockRejectedValue(new Error('offline'));
    expect(shown((await renderSheet({ variant: 'mine', collectionId: null })).renderer)).toContain(i18n.t('submissions.myLoadError'));
  });
});


describe('ApprovalSubmissionSheet - public-link requests of mine (a revoked link never traps one)', () => {
  const memberAndPublic = () => jest.mocked(getMyPendingSubmissionsAcrossCollections).mockResolvedValue({
    items: [
      { ...mine(14, 'ignored'), collectionId: null, collectionName: null },
      mine(13, '위시리스트'),
    ],
    nextCursor: null,
    totalCount: 2,
  });

  it('the global popup lists member requests AND my own public-link requests; the latter say "공유 컬렉션" and never a Collection name', async () => {
    memberAndPublic();
    const { renderer } = await renderSheet({ variant: 'mine', collectionId: null });

    expect(shown(renderer)).toEqual(expect.arrayContaining(['위시리스트', '공유 컬렉션']));
    expect(renderer.root.find(node => node.props.testID === 'my-submission-context-14').findAllByType(ShareIcon)).toHaveLength(1);
    expect(renderer.root.find(node => node.props.testID === 'my-submission-context-13').findAllByType(FolderIcon)).toHaveLength(1);
    expect(JSON.stringify(shown(renderer))).not.toContain('ignored');
    expect(exists(renderer, 'my-submission-14')).toBe(true);
    expect(exists(renderer, 'my-submission-13')).toBe(true);
  });

  it('a public-only row is a status row, not a place: nothing about it navigates into a Collection - and its 요청 취소 still works', async () => {
    memberAndPublic();
    jest.mocked(cancelMySubmission).mockResolvedValue(undefined);
    const onChanged = jest.fn();
    const { renderer } = await renderSheet({ variant: 'mine', collectionId: null, onChanged });

    const row = renderer.root.find(node => node.props.testID === 'my-submission-14');
    // The only press handler inside the card is its external-link icon - nothing navigates; cancelling is the swipe.
    expect(row.findAll(node => typeof node.props.onPress === 'function' && node.props.testID !== 'submission-open-14')).toHaveLength(0);
    expect(swipeRowOf(renderer, 14)).toBeDefined();

    await reveal(renderer, 14);
    await press(renderer, 'submission-cancel-14');
    const confirm = renderer.root.findAllByType(ConfirmDialog).find(dialog => dialog.props.title === '승인 요청을 취소할까요?')!;
    await act(async () => {
      confirm.props.onConfirm();
    });

    // The one canonical own-cancel call - by submission id only, no link and no Collection needed.
    expect(cancelMySubmission).toHaveBeenCalledWith(expect.anything(), 14);
    expect(exists(renderer, 'my-submission-14')).toBe(false);
    expect(exists(renderer, 'my-submission-13')).toBe(true);
    expect(onChanged).toHaveBeenCalledTimes(1);
  });
});

describe('ApprovalSubmissionSheet - compact card, open action and header close', () => {
  const press2 = async (renderer: ReactTestRenderer.ReactTestRenderer, testID: string) => {
    await act(async () => {
      renderer.root.find(node => node.props.testID === testID && typeof node.props.onPress === 'function').props.onPress();
    });
  };

  it('the open icon opens exactly the submitted URL - member row and public/revoked row alike - and cancels, approves or navigates nothing', async () => {
    const openURL = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined as never);
    jest.mocked(getMyPendingSubmissionsAcrossCollections).mockResolvedValue({
      items: [mine(13, '위시리스트'), { ...mine(14, 'x'), collectionId: null, collectionName: null }],
      nextCursor: null,
      totalCount: 2,
    });
    const { renderer } = await renderSheet({ variant: 'mine', collectionId: null });

    await press2(renderer, 'submission-open-13');
    await press2(renderer, 'submission-open-14');

    expect(openURL).toHaveBeenNthCalledWith(1, 'https://example.com/13');
    expect(openURL).toHaveBeenNthCalledWith(2, 'https://example.com/14');
    expect(cancelMySubmission).not.toHaveBeenCalled();
    expect(renderer.root.findAllByType(ConfirmDialog).some(dialog => dialog.props.visible)).toBe(false);
    expect(exists(renderer, 'my-submission-13')).toBe(true);
    expect(exists(renderer, 'my-submission-14')).toBe(true);
    openURL.mockRestore();
  });

  it('a link that cannot be opened says so in the common dialog and changes nothing', async () => {
    const openURL = jest.spyOn(Linking, 'openURL').mockRejectedValue(new Error('no browser'));
    jest.mocked(getMyPendingSubmissionsAcrossCollections).mockResolvedValue({ items: [mine(13, 'A')], nextCursor: null, totalCount: 1 });
    const { renderer } = await renderSheet({ variant: 'mine', collectionId: null });

    await press2(renderer, 'submission-open-13');

    const notice = renderer.root.findAllByType(ConfirmDialog).find(dialog => dialog.props.title === i18n.t('common.notice'))!;
    expect(notice.props.visible).toBe(true);
    expect(notice.props.message).toBe(i18n.t('item.urlOpenFailed'));
    expect(exists(renderer, 'my-submission-13')).toBe(true);
    openURL.mockRestore();
  });

  it('the list closes an open swipe row when it starts scrolling, and the shared row only claims horizontal-dominant drags', async () => {
    jest.mocked(getMyPendingSubmissionsAcrossCollections).mockResolvedValue({ items: [mine(13, 'A')], nextCursor: null, totalCount: 1 });
    const { renderer } = await renderSheet({ variant: 'mine', collectionId: null });

    expect(renderer.root.findByType(FlatList).props.onScrollBeginDrag).toBe(closeOpenRow);
    // The row itself is the shared SwipeableItemRow: it only claims a horizontal-dominant drag (|dx| > 8 and |dx| > |dy|), so
    // vertical or slightly diagonal movement scrolls the sheet - covered by that component's own tests.
    expect(swipeRowOf(renderer, 13)).toBeDefined();
  });

  it('the swipe action (not a permanent icon) is what asks first - nothing is cancelled by the swipe or the tap itself', async () => {
    jest.mocked(getMyPendingSubmissionsAcrossCollections).mockResolvedValue({ items: [mine(13, 'A')], nextCursor: null, totalCount: 1 });
    const { renderer } = await renderSheet({ variant: 'mine', collectionId: null });

    await reveal(renderer, 13);
    await press2(renderer, 'submission-cancel-13');

    expect(cancelMySubmission).not.toHaveBeenCalled();
    expect(renderer.root.findAllByType(ConfirmDialog).find(dialog => dialog.props.title === '승인 요청을 취소할까요?')!.props.visible).toBe(true);
  });

  it('a long title is limited to two lines and the host to one - the title flexes, the icon area is fixed and never wraps', async () => {
    jest.mocked(getMyPendingSubmissionsAcrossCollections).mockResolvedValue({
      items: [mine(13, '위시리스트', '아주 긴 제목 '.repeat(30))],
      nextCursor: null,
      totalCount: 1,
    });
    const { renderer } = await renderSheet({ variant: 'mine', collectionId: null });

    const title = renderer.root.find(node => node.props.testID === 'submission-title-13' && typeof node.type === 'string');
    expect(title.props.numberOfLines).toBe(2);
    const card = renderer.root.find(node => node.props.testID === 'my-submission-info-13' && typeof node.type === 'string');
    expect(StyleSheet.flatten(card.props.style)).toMatchObject({ flex: 1, minWidth: 0 });
    const area = renderer.root.findAll(node => typeof node.type === 'string'
      && StyleSheet.flatten(node.props.style)?.flexShrink === 0
      && StyleSheet.flatten(node.props.style)?.flexDirection === 'row'
      && node.findAll(inner => inner.props.testID === 'submission-open-13').length > 0);
    expect(area.length).toBeGreaterThan(0);
  });

  it('the thumbnail and spacing are compact (project tokens): 64dp thumbnail, 10dp card padding', async () => {
    jest.mocked(getMyPendingSubmissionsAcrossCollections).mockResolvedValue({ items: [mine(13, 'A')], nextCursor: null, totalCount: 1 });
    const { renderer } = await renderSheet({ variant: 'mine', collectionId: null });

    const card = renderer.root.find(node => node.props.testID === 'my-submission-13' && typeof node.type === 'string');
    expect(StyleSheet.flatten(card.props.style)).toMatchObject({ padding: 10 });
    expect(PENDING_SUBMISSION_THUMBNAIL_SIZE).toBe(64);
  });

  it('the sheet closes with the X in its header row - there is no bottom 닫기 row any more', async () => {
    jest.mocked(getMyPendingSubmissionsAcrossCollections).mockResolvedValue({ items: [mine(13, 'A')], nextCursor: null, totalCount: 1 });
    const { renderer, onClose } = await renderSheet({ variant: 'mine', collectionId: null });

    const close = renderer.root.find(node => node.props.testID === 'approval-sheet-close' && typeof node.props.onPress === 'function');
    expect(close.findAllByType(CloseIcon)).toHaveLength(1);
    expect(close.findAllByType(Text)).toHaveLength(0);
    expect(close.props.accessibilityLabel).toBe(i18n.t('common.close'));
    expect(StyleSheet.flatten(close.props.style)).toMatchObject({ height: 44, width: 44 });
    // Same row as the title.
    let row: ReactTestRenderer.ReactTestInstance | null = renderer.root.find(node => node.props.accessibilityRole === 'header' && typeof node.type === 'string');
    while (row && row.findAll(node => node.props.testID === 'approval-sheet-close').length === 0) {
      row = row.parent;
    }
    // The nearest ancestor holding both is a single row (title text + X), not the whole sheet.
    expect(StyleSheet.flatten(row!.props.style)).toMatchObject({ flexDirection: 'row' });
    expect(shown(renderer)).not.toContain('닫기');
    await act(async () => {
      close.props.onPress();
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  describe('the Owner\'s card: informational content + one bottom action strip [open] [reject X] [approve check]', () => {
    const btn = (renderer: ReactTestRenderer.ReactTestRenderer, testID: string) =>
      renderer.root.find(node => node.props.testID === testID && typeof node.props.onPress === 'function');
    const dialogOf = (renderer: ReactTestRenderer.ReactTestRenderer, title: string) =>
      renderer.root.findAllByType(ConfirmDialog).find(dialog => dialog.props.title === title)!;
    afterEach(() => jest.restoreAllMocks());

    it('layout: no right-side X / check cluster, no content press target, no text - one strip of exactly three equal icon zones, each >= 44dp, hairline above', async () => {
      jest.mocked(getCollectionSubmissions).mockResolvedValue({ items: [byMember], nextCursor: null });
      const { renderer } = await renderSheet({ variant: 'owner', collectionId: 5 });

      const open = btn(renderer, 'submission-open-11');
      const reject = btn(renderer, 'submission-reject-11');
      const approve = btn(renderer, 'submission-approve-11');
      expect(open.findAllByType(ExternalLinkIcon)).toHaveLength(1);
      expect(reject.findAllByType(CloseIcon)).toHaveLength(1);
      expect(approve.findAllByType(CheckIcon)).toHaveLength(1);
      for (const action of [open, reject, approve]) {
        expect(action.findAllByType(Text)).toHaveLength(0);
        expect(action.props.accessibilityRole).toBe('button');
        expect(StyleSheet.flatten(action.props.style)).toMatchObject({ flex: 1 });
        expect(StyleSheet.flatten(action.props.style).height).toBeGreaterThanOrEqual(44);
      }
      expect(shown(renderer)).not.toContain('거절');
      expect(shown(renderer)).not.toContain('승인');
      // The information is not interactive any more (the hidden content tap is gone).
      expect(exists(renderer, 'submission-content-11')).toBe(false);
      const card = renderer.root.find(node => node.props.testID === 'submission-11' && typeof node.type === 'string');
      expect(card.findAll(node => typeof node.props.onPress === 'function' && !['submission-open-11', 'submission-reject-11', 'submission-approve-11'].includes(node.props.testID))).toHaveLength(0);
      // One strip row holds exactly the three actions, in order; the top row carries no trailing actions.
      const strip = renderer.root.findAll(node => typeof node.type === 'string' && StyleSheet.flatten(node.props.style)?.flexDirection === 'row'
        && node.findAll(inner => inner === open).length > 0 && node.findAll(inner => inner === approve).length > 0)
        .pop()!;
      const order = strip.findAll(node => ['submission-open-11', 'submission-reject-11', 'submission-approve-11'].includes(node.props.testID) && typeof node.props.onPress === 'function')
        .map(node => node.props.testID);
      expect(order).toEqual(['submission-open-11', 'submission-reject-11', 'submission-approve-11']);
      let wrapper: ReactTestRenderer.ReactTestInstance | null = strip.parent;
      while (wrapper && StyleSheet.flatten(wrapper.props.style)?.borderTopWidth === undefined) {
        wrapper = wrapper.parent;
      }
      expect(StyleSheet.flatten(wrapper!.props.style)).toMatchObject({ borderTopWidth: StyleSheet.hairlineWidth });
      // Reject and Approve are a whole zone apart (the open zone does not sit between nothing - they are not adjacent siblings of tiny size).
      expect(StyleSheet.flatten(reject.props.style).flex).toBe(1);
      expect(StyleSheet.flatten(approve.props.style).flex).toBe(1);
      // Compact content geometry unchanged; no requester behavior.
      expect(renderer.root.findByProps({ testID: 'submission-title-11' }).props.numberOfLines).toBe(2);
      expect(StyleSheet.flatten(card.props.style)).toMatchObject({ padding: 10 });
      expect(swipeRows(renderer)).toHaveLength(0);
    });

    it('labels: "링크 열기: title", "title 거절", "title 승인" - icon-only, role button', async () => {
      jest.mocked(getCollectionSubmissions).mockResolvedValue({ items: [byMember], nextCursor: null });
      const { renderer } = await renderSheet({ variant: 'owner', collectionId: 5 });

      expect(btn(renderer, 'submission-open-11').props.accessibilityLabel).toBe('링크 열기: Member idea');
      expect(btn(renderer, 'submission-reject-11').props.accessibilityLabel).toBe('Member idea 거절');
      expect(btn(renderer, 'submission-approve-11').props.accessibilityLabel).toBe('Member idea 승인');
    });

    it('open: opens exactly the submitted URL (member and public proposals) and approves, rejects, removes or closes nothing', async () => {
      const openURL = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined as never);
      jest.mocked(getCollectionSubmissions).mockResolvedValue({ items: [byMember, viaPublicLink], nextCursor: null });
      const onChanged = jest.fn();
      const { renderer, onClose } = await renderSheet({ variant: 'owner', collectionId: 5, onChanged });

      await act(async () => {
        btn(renderer, 'submission-open-11').props.onPress();
      });
      await act(async () => {
        btn(renderer, 'submission-open-12').props.onPress();
      });

      expect(openURL).toHaveBeenNthCalledWith(1, 'https://example.com/a');
      expect(openURL).toHaveBeenNthCalledWith(2, 'https://news.example.org/b');
      expect(approveCollectionSubmission).not.toHaveBeenCalled();
      expect(rejectCollectionSubmission).not.toHaveBeenCalled();
      expect(renderer.root.findAllByType(ConfirmDialog).some(dialog => dialog.props.visible)).toBe(false);
      expect(exists(renderer, 'submission-11')).toBe(true);
      expect(onChanged).not.toHaveBeenCalled();
      expect(onClose).not.toHaveBeenCalled();
    });

    it('open failure leaves the request unchanged and shows the common 원본 링크를 열 수 없습니다 dialog', async () => {
      jest.spyOn(Linking, 'openURL').mockRejectedValue(new Error('no browser'));
      jest.mocked(getCollectionSubmissions).mockResolvedValue({ items: [byMember], nextCursor: null });
      const { renderer } = await renderSheet({ variant: 'owner', collectionId: 5 });

      await act(async () => {
        btn(renderer, 'submission-open-11').props.onPress();
      });

      const notice = dialogOf(renderer, i18n.t('common.notice'));
      expect(notice.props.visible).toBe(true);
      expect(notice.props.message).toBe(i18n.t('item.urlOpenFailed'));
      expect(exists(renderer, 'submission-11')).toBe(true);
      expect(approveCollectionSubmission).not.toHaveBeenCalled();
      expect(rejectCollectionSubmission).not.toHaveBeenCalled();
    });

    it('reject: X only asks (never opens the URL or approves); keeping the request changes nothing; confirming rejects exactly that request', async () => {
      const openURL = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined as never);
      jest.mocked(getCollectionSubmissions).mockResolvedValue({ items: [byMember, viaPublicLink], nextCursor: null });
      jest.mocked(rejectCollectionSubmission).mockResolvedValue(undefined);
      const { renderer } = await renderSheet({ variant: 'owner', collectionId: 5 });

      await press(renderer, 'submission-reject-11');
      expect(dialogOf(renderer, '이 링크 요청을 거절할까요?').props.visible).toBe(true);
      expect(rejectCollectionSubmission).not.toHaveBeenCalled();
      await act(async () => {
        dialogOf(renderer, '이 링크 요청을 거절할까요?').props.onCancel();
      });
      expect(rejectCollectionSubmission).not.toHaveBeenCalled();
      expect(exists(renderer, 'submission-11')).toBe(true);

      await press(renderer, 'submission-reject-11');
      await act(async () => {
        dialogOf(renderer, '이 링크 요청을 거절할까요?').props.onConfirm();
      });
      expect(rejectCollectionSubmission).toHaveBeenCalledWith(expect.anything(), 5, 11);
      expect(exists(renderer, 'submission-11')).toBe(false);
      expect(openURL).not.toHaveBeenCalled();
      expect(approveCollectionSubmission).not.toHaveBeenCalled();
    });

    it('approve: the check NO LONGER approves directly - it asks 이 링크 요청을 승인할까요?; dismissing does nothing; confirming approves exactly that request', async () => {
      const openURL = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined as never);
      jest.mocked(getCollectionSubmissions).mockResolvedValue({ items: [byMember, viaPublicLink], nextCursor: null });
      jest.mocked(approveCollectionSubmission).mockResolvedValue(undefined);
      const { renderer } = await renderSheet({ variant: 'owner', collectionId: 5 });

      await press(renderer, 'submission-approve-11');
      const dialog = () => dialogOf(renderer, '이 링크 요청을 승인할까요?');
      expect(dialog().props.visible).toBe(true);
      expect(dialog().props.confirmLabel).toBe('승인');
      expect(dialog().props.cancelLabel).toBe('취소');
      expect(dialog().props.destructive).toBe(false);
      expect(approveCollectionSubmission).not.toHaveBeenCalled();
      await act(async () => {
        dialog().props.onCancel();
      });
      expect(approveCollectionSubmission).not.toHaveBeenCalled();
      expect(exists(renderer, 'submission-11')).toBe(true);
      expect(dialog().props.visible).toBe(false);

      await press(renderer, 'submission-approve-11');
      await act(async () => {
        dialog().props.onConfirm();
      });
      expect(approveCollectionSubmission).toHaveBeenCalledTimes(1);
      expect(approveCollectionSubmission).toHaveBeenCalledWith(expect.anything(), 5, 11);
      expect(exists(renderer, 'submission-11')).toBe(false);
      expect(exists(renderer, 'submission-12')).toBe(true);
      expect(openURL).not.toHaveBeenCalled();
      expect(rejectCollectionSubmission).not.toHaveBeenCalled();
    });

    it('loading: after an approve is confirmed the check shows the spinner and every icon (open included) is disabled; a repeated confirm sends nothing', async () => {
      jest.mocked(getCollectionSubmissions).mockResolvedValue({ items: [byMember, viaPublicLink], nextCursor: null });
      let finish!: () => void;
      jest.mocked(approveCollectionSubmission).mockReturnValue(new Promise<void>(resolve => { finish = resolve; }));
      const { renderer } = await renderSheet({ variant: 'owner', collectionId: 5 });

      await press(renderer, 'submission-approve-11');
      const confirm = () => dialogOf(renderer, '이 링크 요청을 승인할까요?');
      const onConfirm = confirm().props.onConfirm;
      act(() => {
        onConfirm();
      });
      act(() => {
        onConfirm();
      });

      expect(approveCollectionSubmission).toHaveBeenCalledTimes(1);
      expect(btn(renderer, 'submission-approve-11').props.accessibilityState).toEqual({ disabled: true, busy: true });
      expect(btn(renderer, 'submission-approve-11').findAllByType(CheckIcon)).toHaveLength(0);
      expect(btn(renderer, 'submission-reject-11').props.accessibilityState).toEqual({ disabled: true, busy: false });
      expect(btn(renderer, 'submission-open-11').props.accessibilityState).toEqual({ disabled: true });
      expect(btn(renderer, 'submission-reject-12').props.disabled).toBe(true);
      expect(btn(renderer, 'submission-open-12').props.disabled).toBe(true);
      await act(async () => {
        finish();
      });
      expect(exists(renderer, 'submission-11')).toBe(false);
      expect(btn(renderer, 'submission-approve-12').props.accessibilityState).toEqual({ disabled: false, busy: false });
    });

    it('loading: a rejection shows the spinner on the X and disables the rest; a failure keeps the row, restores all three icons and shows the common message', async () => {
      jest.mocked(getCollectionSubmissions).mockResolvedValue({ items: [byMember, viaPublicLink], nextCursor: null });
      let fail!: (error: Error) => void;
      jest.mocked(rejectCollectionSubmission).mockReturnValue(new Promise<void>((_resolve, reject) => { fail = reject; }));
      const { renderer } = await renderSheet({ variant: 'owner', collectionId: 5 });

      await press(renderer, 'submission-reject-11');
      await act(async () => {
        dialogOf(renderer, '이 링크 요청을 거절할까요?').props.onConfirm();
      });
      expect(btn(renderer, 'submission-reject-11').props.accessibilityState).toEqual({ disabled: true, busy: true });
      expect(btn(renderer, 'submission-reject-11').findAllByType(CloseIcon)).toHaveLength(0);
      expect(btn(renderer, 'submission-approve-11').props.accessibilityState).toEqual({ disabled: true, busy: false });

      await act(async () => {
        fail(new Error('offline'));
      });
      expect(exists(renderer, 'submission-11')).toBe(true);
      expect(shown(renderer)).toContain(i18n.t('submissions.actionError'));
      for (const id of ['submission-open-11', 'submission-reject-11', 'submission-approve-11']) {
        expect(btn(renderer, id).props.accessibilityState.disabled).toBe(false);
      }
      expect(btn(renderer, 'submission-reject-11').findAllByType(CloseIcon)).toHaveLength(1);
    });
  });

  it('requester cards never get the Owner\'s X / check, and keep their link icon and swipe-to-cancel', async () => {
    jest.mocked(getMyPendingSubmissionsAcrossCollections).mockResolvedValue({ items: [mine(13, 'A')], nextCursor: null, totalCount: 1 });
    const { renderer } = await renderSheet({ variant: 'mine', collectionId: null });

    expect(exists(renderer, 'submission-reject-13')).toBe(false);
    expect(exists(renderer, 'submission-approve-13')).toBe(false);
    expect(exists(renderer, 'submission-open-13')).toBe(true);
    expect(swipeRowOf(renderer, 13)).toBeDefined();
  });
});

describe('ApprovalSubmissionSheet - 요청 취소 (cancel my own pending request)', () => {
  const twoOfMine = () => jest.mocked(getMyPendingSubmissionsAcrossCollections).mockResolvedValue({
    items: [mine(13, '위시리스트'), mine(12, '여행')],
    nextCursor: null,
    totalCount: 2,
  });
  const confirmDialog = (renderer: ReactTestRenderer.ReactTestRenderer, title: string) =>
    renderer.root.findAllByType(ConfirmDialog).find(dialog => dialog.props.title === title)!;
  const cancelConfirm = (renderer: ReactTestRenderer.ReactTestRenderer) => confirmDialog(renderer, '승인 요청을 취소할까요?');

  it('every pending row of mine shows ONLY the external-link icon (no always-visible trash); cancelling is a left swipe revealing a red icon-only action with the cancellation label - and the Owner\'s rows have neither', async () => {
    twoOfMine();
    const { renderer } = await renderSheet({ variant: 'mine', collectionId: null });

    for (const id of [13, 12]) {
      // Nothing destructive is on screen until the card is swiped.
      expect(renderer.root.findAll(node => node.props.testID === `submission-cancel-${id}`)).toHaveLength(0);
      expect(renderer.root.findByProps({ testID: `my-submission-${id}` }).findAllByType(TrashIcon)).toHaveLength(0);
      const open = renderer.root.find(node => node.props.testID === `submission-open-${id}` && typeof node.props.onPress === 'function');
      expect(open.findAllByType(ExternalLinkIcon)).toHaveLength(1);
      expect(open.findAllByType(Text)).toHaveLength(0);
      expect(open.props.accessibilityLabel).toContain('링크 열기');
      expect(StyleSheet.flatten(open.props.style)).toMatchObject({ height: 44, width: 44 });
      // The icon sits in the card's fixed end area, beside the information.
      const card = renderer.root.find(node => node.props.testID === `my-submission-${id}`);
      const top = card.findAll(node => typeof node.type === 'string' && StyleSheet.flatten(node.props.style)?.flexDirection === 'row' && node.findAll(inner => inner === open).length > 0)[0];
      expect(top.findAll(node => node.props.testID === `my-submission-info-${id}`).length).toBeGreaterThan(0);

      // The shared swipe row: delete-only (no share), icon-only, labelled as cancelling an approval request.
      const swipe = swipeRowOf(renderer, id);
      expect(swipe.props.onShare).toBeUndefined();
      expect(swipe.props.deleteIconOnly).toBe(true);
      expect(swipe.props.deleteLabel).toContain('승인 요청 취소');
      expect(swipe.props.deleteLabel).not.toContain('삭제');
      await reveal(renderer, id);
      const action = renderer.root.find(node => node.props.testID === `submission-cancel-${id}` && typeof node.props.onPress === 'function');
      expect(action.findAllByType(TrashIcon)).toHaveLength(1);
      expect(action.findAllByType(Text)).toHaveLength(0);
      expect(action.props.accessibilityLabel).toContain('승인 요청 취소');
      expect(StyleSheet.flatten(action.props.style)).toMatchObject({ minHeight: 44 });
      // Swiping alone cancelled nothing and asked nothing.
      expect(cancelMySubmission).not.toHaveBeenCalled();
      expect(renderer.root.findAllByType(ConfirmDialog).some(dialog => dialog.props.visible)).toBe(false);
    }

    jest.mocked(getCollectionSubmissions).mockResolvedValue({ items: [byMember], nextCursor: null });
    const owner = (await renderSheet({ variant: 'owner', collectionId: 5 })).renderer;
    // The Owner's cards are not swipeable and keep their text Reject / Approve.
    expect(swipeRows(owner)).toHaveLength(0);
    expect(exists(owner, 'submission-cancel-11')).toBe(false);
    expect(exists(owner, 'submission-approve-11')).toBe(true);
    expect(exists(owner, 'submission-reject-11')).toBe(true);
  });

  it('tapping it only asks: 승인 요청을 취소할까요? - keeping the request changes nothing', async () => {
    twoOfMine();
    const { renderer } = await renderSheet({ variant: 'mine', collectionId: null });

    await reveal(renderer, 13);
    await press(renderer, 'submission-cancel-13');

    expect(cancelConfirm(renderer).props.visible).toBe(true);
    expect(cancelConfirm(renderer).props.confirmLabel).toBe('요청 취소');
    expect(cancelConfirm(renderer).props.cancelLabel).toBe('그대로 두기');
    expect(cancelMySubmission).not.toHaveBeenCalled();
    await act(async () => {
      cancelConfirm(renderer).props.onCancel();
    });
    expect(cancelConfirm(renderer).props.visible).toBe(false);
    expect(cancelMySubmission).not.toHaveBeenCalled();
    expect(exists(renderer, 'my-submission-13')).toBe(true);
  });

  it('confirming cancels exactly that proposal (no user id), the row leaves, the caller refreshes counts, and the sheet stays open with a compact empty state after the last one', async () => {
    twoOfMine();
    jest.mocked(cancelMySubmission).mockResolvedValue(undefined);
    const onChanged = jest.fn();
    const { renderer, onClose } = await renderSheet({ variant: 'mine', collectionId: null, onChanged });

    await reveal(renderer, 13);
    await press(renderer, 'submission-cancel-13');
    await act(async () => {
      cancelConfirm(renderer).props.onConfirm();
    });

    expect(cancelMySubmission).toHaveBeenCalledTimes(1);
    expect(cancelMySubmission).toHaveBeenCalledWith(expect.anything(), 13);
    expect(exists(renderer, 'my-submission-13')).toBe(false);
    expect(exists(renderer, 'my-submission-12')).toBe(true);
    expect(onChanged).toHaveBeenCalledTimes(1);

    await reveal(renderer, 12);
    await press(renderer, 'submission-cancel-12');
    await act(async () => {
      cancelConfirm(renderer).props.onConfirm();
    });
    expect(shown(renderer)).toContain(i18n.t('submissions.myEmpty'));
    expect(onClose).not.toHaveBeenCalled();
    expect(onChanged).toHaveBeenCalledTimes(2);
  });

  it('a failure keeps the row and says so in the common message dialog; it can be retried', async () => {
    twoOfMine();
    jest.mocked(cancelMySubmission).mockRejectedValueOnce(new Error('offline'));
    const { renderer } = await renderSheet({ variant: 'mine', collectionId: null });

    await reveal(renderer, 13);
    await press(renderer, 'submission-cancel-13');
    await act(async () => {
      cancelConfirm(renderer).props.onConfirm();
    });

    expect(exists(renderer, 'my-submission-13')).toBe(true);
    const notice = confirmDialog(renderer, i18n.t('common.notice'));
    expect(notice.props.visible).toBe(true);
    expect(notice.props.message).toBe(i18n.t('submissions.cancelFailed'));
    await act(async () => {
      notice.props.onConfirm();
    });
    expect(confirmDialog(renderer, i18n.t('common.notice')).props.visible).toBe(false);
    // Back to normal: the row is still there, swiping is available again and no row is left half open or busy.
    expect(swipeRowOf(renderer, 13).props.disabled).toBe(false);
    expect(renderer.root.find(node => node.props.testID === 'submission-open-13' && typeof node.props.onPress === 'function').findAllByType(ExternalLinkIcon)).toHaveLength(1);
  });

  it('is single-flight: while one cancel runs the action is disabled and a second confirm sends nothing', async () => {
    twoOfMine();
    let finish!: () => void;
    jest.mocked(cancelMySubmission).mockReturnValue(new Promise<void>(resolve => { finish = resolve; }));
    const { renderer } = await renderSheet({ variant: 'mine', collectionId: null });

    await reveal(renderer, 13);
    await press(renderer, 'submission-cancel-13');
    await act(async () => {
      cancelConfirm(renderer).props.onConfirm();
    });
    await act(async () => {
      cancelConfirm(renderer).props.onConfirm();
    });

    expect(cancelMySubmission).toHaveBeenCalledTimes(1);
    // While it runs every card's swipe is off (single-flight) and its own link icon shows the spinner.
    expect(swipeRowOf(renderer, 13).props.disabled).toBe(true);
    expect(swipeRowOf(renderer, 12).props.disabled).toBe(true);
    expect(renderer.root.find(node => node.props.testID === 'submission-open-13' && typeof node.props.onPress === 'function').findAllByType(ExternalLinkIcon)).toHaveLength(0);
    await act(async () => {
      finish();
    });
    expect(exists(renderer, 'my-submission-13')).toBe(false);
  });

  it('a request that was already answered (404): the row leaves and the message says it was already handled', async () => {
    twoOfMine();
    jest.mocked(cancelMySubmission).mockRejectedValue(new ApiError('notFound', 404));
    const onChanged = jest.fn();
    const { renderer } = await renderSheet({ variant: 'mine', collectionId: null, onChanged });

    await reveal(renderer, 13);
    await press(renderer, 'submission-cancel-13');
    await act(async () => {
      cancelConfirm(renderer).props.onConfirm();
    });

    expect(exists(renderer, 'my-submission-13')).toBe(false);
    expect(confirmDialog(renderer, i18n.t('common.notice')).props.message).toBe('이미 처리된 요청입니다.');
    expect(onChanged).toHaveBeenCalled();
  });
});

describe('ApprovalSubmissionSheet - the Owner\'s open popup follows a requester\'s cancellation', () => {
  it('a refresh signal for this Collection re-reads the queue silently (no polling): the cancelled row is gone, the rest stays', async () => {
    jest.mocked(getCollectionSubmissions).mockResolvedValueOnce({ items: [byMember, viaPublicLink], nextCursor: null });
    const { renderer } = await renderSheet({ variant: 'owner', collectionId: 5 });
    expect(exists(renderer, 'submission-11')).toBe(true);
    expect(getCollectionSubmissions).toHaveBeenCalledTimes(1);

    jest.mocked(getCollectionSubmissions).mockResolvedValue({ items: [viaPublicLink], nextCursor: null });
    await act(async () => {
      emitSocialPushEvent({ type: 'collectionContentChanged', collectionId: 5 });
    });

    expect(getCollectionSubmissions).toHaveBeenCalledTimes(2);
    expect(exists(renderer, 'submission-11')).toBe(false);
    expect(exists(renderer, 'submission-12')).toBe(true);
    expect(exists(renderer, 'approval-sheet-skeleton')).toBe(false);
  });

  it('a signal for ANOTHER Collection, or while the sheet is closed, does nothing', async () => {
    jest.mocked(getCollectionSubmissions).mockResolvedValue({ items: [byMember], nextCursor: null });
    await renderSheet({ variant: 'owner', collectionId: 5 });
    await renderSheet({ variant: 'owner', collectionId: 5, visible: false });
    jest.mocked(getCollectionSubmissions).mockClear();

    await act(async () => {
      emitSocialPushEvent({ type: 'collectionContentChanged', collectionId: 99 });
    });
    expect(getCollectionSubmissions).not.toHaveBeenCalled();
  });

  it('a stale Approve on a request the requester cancelled is safe: the row leaves with the already-cancelled-or-handled message, nothing is added', async () => {
    jest.mocked(getCollectionSubmissions).mockResolvedValue({ items: [byMember, viaPublicLink], nextCursor: null });
    jest.mocked(approveCollectionSubmission).mockRejectedValue(new ApiError('notFound', 404));
    const onChanged = jest.fn();
    const { renderer } = await renderSheet({ variant: 'owner', collectionId: 5, onChanged });

    await approveOwner(renderer, 11);

    expect(exists(renderer, 'submission-11')).toBe(false);
    expect(exists(renderer, 'submission-12')).toBe(true);
    expect(shown(renderer)).toContain('이미 취소되었거나 처리된 요청입니다.');
    expect(onChanged).toHaveBeenCalled();
  });
});
