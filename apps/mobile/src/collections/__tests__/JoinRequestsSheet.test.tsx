import ReactTestRenderer, { act } from 'react-test-renderer';
import { FlatList, Modal, StyleSheet, Text } from 'react-native';
import i18n from '../../i18n';
import { ApiError } from '../../api/ApiError';
import { BottomSheetModal } from '../../components/BottomSheetModal';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { UserAvatar } from '../../components/UserAvatar';
import { emitSocialPushEvent } from '../../push/pushEvents';
import { JoinRequestsSheet } from '../JoinRequestsSheet';
import { PendingSubmissionCardSkeleton } from '../PendingSubmissionCard';
import {
  approveCollectionJoinRequest,
  listCollectionJoinRequests,
  rejectCollectionJoinRequest,
  type CollectionJoinRequest,
} from '../api/collectionsApi';

jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: ({ children }: { children: React.ReactNode }) => children,
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));
jest.mock('../api/collectionsApi', () => ({
  listCollectionJoinRequests: jest.fn(),
  approveCollectionJoinRequest: jest.fn(),
  rejectCollectionJoinRequest: jest.fn(),
}));

type Renderer = ReactTestRenderer.ReactTestRenderer;
const request = jest.fn();
const waiting = (requestId: number, jupleId: string, displayName: string | null): CollectionJoinRequest => ({
  requestId, jupleId, displayName, profileImageUrl: null, profileImageVersion: null, requestedAtUtc: '2026-10-09T00:00:00Z',
});

beforeAll(async () => {
  await i18n.changeLanguage('ko');
});
beforeEach(() => {
  jest.mocked(listCollectionJoinRequests).mockResolvedValue([waiting(11, 'ALIC2345', '꼬부기'), waiting(12, 'BOBB2345', null)]);
});
afterEach(() => jest.clearAllMocks());

async function renderSheet(props: { visible?: boolean; onClose?: () => void; onChanged?: () => void } = {}) {
  const onClose = props.onClose ?? jest.fn();
  const onChanged = props.onChanged ?? jest.fn();
  let renderer!: Renderer;
  await act(async () => {
    renderer = ReactTestRenderer.create(
      <JoinRequestsSheet authenticatedRequest={request as never} collectionId={5} expectedCount={2} onChanged={onChanged} onClose={onClose} visible={props.visible ?? true} />,
    );
  });
  return { renderer, onClose, onChanged };
}

const byId = (renderer: Renderer, testID: string) => renderer.root.findAll(node => node.props.testID === testID && typeof node.props.onPress === 'function')[0];
const exists = (renderer: Renderer, testID: string) => renderer.root.findAll(node => node.props.testID === testID).length > 0;
const texts = (node: Renderer | ReactTestRenderer.ReactTestInstance) => ('root' in node ? node.root : node).findAllByType(Text).map(text => String(text.props.children));
const openConfirm = (renderer: Renderer, title: string) =>
  renderer.root.findAll(node => node.type === ConfirmDialog && node.props.visible === true && node.props.title === title)[0];
const press = async (renderer: Renderer, testID: string) => {
  await act(async () => {
    byId(renderer, testID).props.onPress();
  });
};
const shownMessages = (renderer: Renderer) =>
  renderer.root.findAll(node => node.type === Modal && node.props.visible === true).flatMap(modal => modal.findAllByType(Text).map(text => String(text.props.children)));

describe('JoinRequestsSheet - 참여 요청 in the same bottom-sheet system as 받은 승인 요청', () => {
  it('is the shared BottomSheetModal: title and the X in one header row, the X closes it', async () => {
    const { renderer, onClose } = await renderSheet();

    const sheet = renderer.root.findByType(BottomSheetModal);
    expect(sheet.props.visible).toBe(true);
    expect(sheet.props.testID).toBe('join-requests-sheet');
    expect(texts(renderer)).toContain('참여 요청');
    for (const forbidden of ['컬렉션 참여 요청', '받은 초대 요청', '수락', '초대']) {
      expect(texts(renderer).join('|')).not.toContain(forbidden);
    }
    await press(renderer, 'join-requests-sheet-close');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('nothing is loaded until the sheet is opened', async () => {
    await renderSheet({ visible: false });
    expect(listCollectionJoinRequests).not.toHaveBeenCalled();
  });

  it('shows the final geometry at once: skeleton cards of the shared card frame while the first load runs', async () => {
    let release!: (rows: CollectionJoinRequest[]) => void;
    jest.mocked(listCollectionJoinRequests).mockReturnValue(new Promise(resolve => { release = resolve; }));
    const { renderer } = await renderSheet();

    expect(exists(renderer, 'join-requests-skeleton')).toBe(true);
    expect(renderer.root.findAllByType(PendingSubmissionCardSkeleton)).toHaveLength(2);
    await act(async () => {
      release([waiting(11, 'ALIC2345', '꼬부기')]);
    });
    expect(exists(renderer, 'join-requests-skeleton')).toBe(false);
    expect(exists(renderer, 'join-request-11')).toBe(true);
  });

  it('each card is one applicant: avatar, name (and the Juple ID under a chosen name), then 거절 / 승인 in that order, 44dp or more', async () => {
    const { renderer } = await renderSheet();

    const card = renderer.root.findAll(node => node.props.testID === 'join-request-11' && node.type !== undefined && typeof node.type === 'function')[0]
      ?? renderer.root.findAll(node => node.props.testID === 'join-request-11')[0];
    expect(card.findAllByType(UserAvatar)).toHaveLength(1);
    const cardTexts = texts(card);
    expect(cardTexts).toEqual(expect.arrayContaining(['꼬부기', '거절', '승인']));
    expect(cardTexts.indexOf('거절')).toBeLessThan(cardTexts.indexOf('승인'));
    // A person without a display name is shown by their Juple ID alone.
    expect(texts(renderer.root.findAll(node => node.props.testID === 'join-request-12')[0]).join(' ')).toContain('BOBB');
    for (const id of ['join-request-approve-11', 'join-request-reject-11']) {
      expect(StyleSheet.flatten(byId(renderer, id).props.style).height).toBeGreaterThanOrEqual(44);
    }
    // The cards are scrollable content (many applicants scroll inside the sheet).
    expect(renderer.root.findAllByType(FlatList)).toHaveLength(1);
  });

  it('no link content is faked on an applicant card: no thumbnail, title, host or open-link action', async () => {
    const { renderer } = await renderSheet();

    expect(renderer.root.findAll(node => String(node.props.testID).startsWith('submission-thumbnail-'))).toHaveLength(0);
    expect(renderer.root.findAll(node => String(node.props.testID).startsWith('submission-open-'))).toHaveLength(0);
  });

  it('승인 asks first (centered dialog); cancelling sends nothing; confirming approves exactly that request - the card goes, the other stays, the caller is told', async () => {
    jest.mocked(approveCollectionJoinRequest).mockResolvedValue(undefined);
    const { renderer, onChanged, onClose } = await renderSheet();

    await press(renderer, 'join-request-approve-11');
    expect(openConfirm(renderer, '참여 요청을 승인할까요?')).toBeDefined();
    await act(async () => {
      openConfirm(renderer, '참여 요청을 승인할까요?').props.onCancel();
    });
    expect(approveCollectionJoinRequest).not.toHaveBeenCalled();

    await press(renderer, 'join-request-approve-11');
    await act(async () => {
      openConfirm(renderer, '참여 요청을 승인할까요?').props.onConfirm();
    });

    expect(approveCollectionJoinRequest).toHaveBeenCalledWith(expect.anything(), 5, 11);
    expect(rejectCollectionJoinRequest).not.toHaveBeenCalled();
    expect(exists(renderer, 'join-request-11')).toBe(false);
    expect(exists(renderer, 'join-request-12')).toBe(true);
    expect(onChanged).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('거절 asks first (destructive) and declines only that request', async () => {
    jest.mocked(rejectCollectionJoinRequest).mockResolvedValue(undefined);
    const { renderer, onChanged } = await renderSheet();

    await press(renderer, 'join-request-reject-11');
    const dialog = openConfirm(renderer, '참여 요청을 거절할까요?');
    expect(dialog.props.destructive).toBe(true);
    await act(async () => {
      dialog.props.onConfirm();
    });

    expect(rejectCollectionJoinRequest).toHaveBeenCalledWith(expect.anything(), 5, 11);
    expect(approveCollectionJoinRequest).not.toHaveBeenCalled();
    expect(exists(renderer, 'join-request-11')).toBe(false);
    expect(exists(renderer, 'join-request-12')).toBe(true);
    expect(onChanged).toHaveBeenCalledTimes(1);
  });

  it('answering the LAST applicant closes the sheet, like the approval queue', async () => {
    jest.mocked(listCollectionJoinRequests).mockResolvedValue([waiting(11, 'ALIC2345', '꼬부기')]);
    jest.mocked(approveCollectionJoinRequest).mockResolvedValue(undefined);
    const { renderer, onClose } = await renderSheet();

    await press(renderer, 'join-request-approve-11');
    await act(async () => {
      openConfirm(renderer, '참여 요청을 승인할까요?').props.onConfirm();
    });

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('a failure keeps the sheet open and the card in place, and says so in the common centered message', async () => {
    jest.mocked(approveCollectionJoinRequest).mockRejectedValue(new ApiError('unavailable', 503));
    const { renderer, onChanged, onClose } = await renderSheet();

    await press(renderer, 'join-request-approve-11');
    await act(async () => {
      openConfirm(renderer, '참여 요청을 승인할까요?').props.onConfirm();
    });

    expect(exists(renderer, 'join-request-11')).toBe(true);
    expect(onChanged).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    expect(shownMessages(renderer)).toContain(i18n.t('submissions.actionError'));
    // The buttons work again afterwards (the busy state was released).
    expect(byId(renderer, 'join-request-approve-12').props.accessibilityState.disabled).toBe(false);
  });

  it('a request that can no longer be approved is said plainly and leaves the sheet - the card does not linger', async () => {
    jest.mocked(approveCollectionJoinRequest).mockRejectedValue(new ApiError('conflict', 409, 'joinNotAllowed'));
    const { renderer, onChanged } = await renderSheet();

    await press(renderer, 'join-request-approve-11');
    await act(async () => {
      openConfirm(renderer, '참여 요청을 승인할까요?').props.onConfirm();
    });

    expect(shownMessages(renderer)).toContain(i18n.t('shareSheet.joinRequestNotActionable'));
    expect(exists(renderer, 'join-request-11')).toBe(false);
    expect(onChanged).toHaveBeenCalledTimes(1);
  });

  it('only one answer runs at a time: while one is in flight every button is disabled and a second tap sends nothing', async () => {
    let release!: () => void;
    jest.mocked(approveCollectionJoinRequest).mockReturnValue(new Promise<void>(resolve => { release = resolve; }));
    const { renderer } = await renderSheet();

    await press(renderer, 'join-request-approve-11');
    await act(async () => {
      openConfirm(renderer, '참여 요청을 승인할까요?').props.onConfirm();
    });

    for (const id of ['join-request-reject-11', 'join-request-approve-12', 'join-request-reject-12']) {
      expect(byId(renderer, id).props.accessibilityState.disabled).toBe(true);
    }
    expect(approveCollectionJoinRequest).toHaveBeenCalledTimes(1);
    await act(async () => {
      release();
    });
    expect(exists(renderer, 'join-request-11')).toBe(false);
  });

  it('a load failure is the common failure state with a retry, and nothing is invented', async () => {
    jest.mocked(listCollectionJoinRequests).mockRejectedValue(new ApiError('unavailable', 503));
    const { renderer } = await renderSheet();

    expect(exists(renderer, 'join-requests-empty')).toBe(true);
    expect(exists(renderer, 'join-request-11')).toBe(false);
  });

  it('a new applicant arriving by Push re-reads the open sheet silently', async () => {
    const { renderer } = await renderSheet();
    jest.mocked(listCollectionJoinRequests).mockResolvedValue([waiting(11, 'ALIC2345', '꼬부기'), waiting(12, 'BOBB2345', null), waiting(13, 'CARL2345', '파이리')]);

    await act(async () => {
      emitSocialPushEvent({ type: 'joinRequest', collectionId: 5, itemId: null, notificationId: null, publicId: null } as never);
    });

    expect(exists(renderer, 'join-request-13')).toBe(true);
  });
});
