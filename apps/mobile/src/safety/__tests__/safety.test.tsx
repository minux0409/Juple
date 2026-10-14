import ReactTestRenderer, { act } from 'react-test-renderer';
import { ApiError } from '../../api/ApiError';
import { BlockedUsersScreen } from '../../screens/BlockedUsersScreen';
import i18n from '../../i18n';
import { ReportModal } from '../ReportModal';
import { TermsGate } from '../TermsGate';
import {
  acceptTerms,
  blockedInteractionKey,
  getTermsStatus,
  isTermsRequiredError,
  listBlockedUsers,
  parseBlockedUsers,
  parseTermsStatus,
  reportBody,
  REPORT_REASONS,
  submitReport,
  unblockUser,
} from '../safetyApi';
import { notifyTermsAcceptanceRequired } from '../termsRequiredEvents';

const mockRequest = jest.fn();
jest.mock('../../api/useAuthenticatedApi', () => ({ useAuthenticatedApi: () => mockRequest }));
jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: ({ children }: { children: React.ReactNode }) => children,
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));
jest.mock('../../config/legalLinks', () => ({ legalLinks: { termsUrl: 'https://example.test/terms', privacyUrl: 'https://example.test/privacy' } }));
const mockAuth = { isAuthenticated: true, userBootstrapStatus: 'ready' };
jest.mock('../../auth/AuthContext', () => ({ useAuth: () => mockAuth }));
jest.mock('../safetyApi', () => ({
  ...jest.requireActual('../safetyApi'),
  getTermsStatus: jest.fn(),
  acceptTerms: jest.fn(),
  submitReport: jest.fn(),
  listBlockedUsers: jest.fn(),
  unblockUser: jest.fn(),
}));

beforeAll(async () => {
  await i18n.changeLanguage('ko');
});
afterEach(() => {
  jest.clearAllMocks();
  mockAuth.isAuthenticated = true;
  mockAuth.userBootstrapStatus = 'ready';
});

const byId = (renderer: ReactTestRenderer.ReactTestRenderer, testID: string) =>
  renderer.root.find(node => node.props.testID === testID && typeof node.props.onPress === 'function');
const exists = (renderer: ReactTestRenderer.ReactTestRenderer, testID: string) => renderer.root.findAll(node => node.props.testID === testID).length > 0;
const press = async (renderer: ReactTestRenderer.ReactTestRenderer, testID: string) => {
  await act(async () => {
    byId(renderer, testID).props.onPress();
  });
};

describe('the safety API module', () => {
  it('reads the Terms status defensively', () => {
    expect(parseTermsStatus({ currentVersion: '2026-10-14', acceptedVersion: null, isAccepted: false })).toEqual({ currentVersion: '2026-10-14', acceptedVersion: null, isAccepted: false });
    expect(parseTermsStatus({ currentVersion: '', isAccepted: true })).toBeNull();
    expect(parseTermsStatus(null)).toBeNull();
    expect(parseTermsStatus({ currentVersion: 'v', isAccepted: 'yes' })).toBeNull();
  });

  it('recognises only the server\'s termsAcceptanceRequired as "accept the Terms first"', () => {
    expect(isTermsRequiredError(new ApiError('forbidden', 403, 'termsAcceptanceRequired'))).toBe(true);
    expect(isTermsRequiredError(new ApiError('forbidden', 403, 'subscriptionRequired'))).toBe(false);
    expect(isTermsRequiredError(new ApiError('notFound', 404))).toBe(false);
  });

  it('builds the report body: Juple ID for a person, ids for the rest, an item through its Collection; blank details are omitted', () => {
    expect(reportBody({ type: 'User', jupleId: 'ABCD2345' }, 'Spam', '  ')).toEqual({ targetType: 'User', targetId: 'ABCD2345', reason: 'Spam' });
    expect(reportBody({ type: 'Collection', collectionId: 4 }, 'Illegal', ' why ')).toEqual({ targetType: 'Collection', targetId: '4', reason: 'Illegal', details: 'why' });
    expect(reportBody({ type: 'Item', itemId: 9, collectionId: 4 }, 'Other', '')).toEqual({ targetType: 'Item', targetId: '9', collectionId: 4, reason: 'Other' });
    expect(reportBody({ type: 'Comment', commentId: 7 }, 'HateOrAbuse', '')).toEqual({ targetType: 'Comment', targetId: '7', reason: 'HateOrAbuse' });
    expect(REPORT_REASONS).toEqual(['Spam', 'Harassment', 'HateOrAbuse', 'SexualOrInappropriate', 'Illegal', 'ScamOrMaliciousLink', 'IntellectualProperty', 'Other']);
  });

  it('words a block-refused interaction, and nothing else', () => {
    expect(blockedInteractionKey(new ApiError('forbidden', 403, 'userBlocked'))).toBe('safety.userBlockedByYou');
    expect(blockedInteractionKey(new ApiError('forbidden', 403, 'interactionNotAllowed'))).toBe('safety.interactionNotAllowed');
    expect(blockedInteractionKey(new ApiError('forbidden', 403, 'other'))).toBeNull();
    expect(blockedInteractionKey(new Error('x'))).toBeNull();
  });

  it('reads the blocked list defensively', () => {
    const users = parseBlockedUsers({ items: [{ jupleId: 'AAAA2222', displayName: ' ', blockedAtUtc: 't' }, { jupleId: '' }, null, { jupleId: 'BBBB3333', displayName: 'Bo' }] });
    expect(users.map(user => user.jupleId)).toEqual(['AAAA2222', 'BBBB3333']);
    expect(users[0].displayName).toBeNull();
    expect(parseBlockedUsers(undefined)).toEqual([]);
  });
});

describe('ReportModal', () => {
  it('shows every reason, sends nothing until one is chosen, then sends it with the optional words', async () => {
    jest.mocked(submitReport).mockResolvedValue({ alreadyReported: false });
    const onReported = jest.fn();
    let renderer!: ReactTestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = ReactTestRenderer.create(<ReportModal onClose={jest.fn()} onReported={onReported} target={{ type: 'Comment', commentId: 7 }} />);
    });
    for (const reason of REPORT_REASONS) {
      expect(exists(renderer, `report-reason-${reason}`)).toBe(true);
    }
    expect(byId(renderer, 'report-submit').props.disabled).toBe(true);

    await press(renderer, 'report-reason-ScamOrMaliciousLink');
    await act(async () => {
      renderer.root.find(node => node.props.testID === 'report-details' && typeof node.props.onChangeText === 'function').props.onChangeText('a bad link');
    });
    await press(renderer, 'report-submit');

    expect(submitReport).toHaveBeenCalledWith(expect.any(Function), { type: 'Comment', commentId: 7 }, 'ScamOrMaliciousLink', 'a bad link');
    expect(onReported).toHaveBeenCalledWith(false);
  });

  it('says "already reported" for an open report and keeps the dialog with an error when sending fails', async () => {
    jest.mocked(submitReport).mockResolvedValueOnce({ alreadyReported: true });
    const onReported = jest.fn();
    let renderer!: ReactTestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = ReactTestRenderer.create(<ReportModal onClose={jest.fn()} onReported={onReported} target={{ type: 'User', jupleId: 'ABCD2345' }} />);
    });
    await press(renderer, 'report-reason-Spam');
    await press(renderer, 'report-submit');
    expect(onReported).toHaveBeenCalledWith(true);

    jest.mocked(submitReport).mockRejectedValueOnce(new ApiError('unavailable'));
    await press(renderer, 'report-submit');
    expect(exists(renderer, 'report-error')).toBe(true);
    expect(onReported).toHaveBeenCalledTimes(1);
  });

  it('draws nothing without a target', async () => {
    let renderer!: ReactTestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = ReactTestRenderer.create(<ReportModal onClose={jest.fn()} onReported={jest.fn()} target={null} />);
    });
    expect(exists(renderer, 'report-modal')).toBe(false);
  });
});

describe('TermsGate', () => {
  const status = (accepted: boolean) => ({ currentVersion: '2026-10-14', acceptedVersion: accepted ? '2026-10-14' : null, isAccepted: accepted });

  async function mount() {
    let renderer!: ReactTestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = ReactTestRenderer.create(<TermsGate />);
    });
    return renderer;
  }

  it('asks an account that has not accepted: links, an unchecked agreement, and accept only after checking it', async () => {
    jest.mocked(getTermsStatus).mockResolvedValue(status(false));
    jest.mocked(acceptTerms).mockResolvedValue(status(true));
    const renderer = await mount();

    expect(exists(renderer, 'terms-gate')).toBe(true);
    expect(exists(renderer, 'terms-view-terms')).toBe(true);
    expect(exists(renderer, 'terms-view-privacy')).toBe(true);
    expect(byId(renderer, 'terms-accept').props.disabled).toBe(true);

    await press(renderer, 'terms-agree');
    expect(byId(renderer, 'terms-accept').props.disabled).toBe(false);
    await press(renderer, 'terms-accept');

    expect(acceptTerms).toHaveBeenCalledWith(expect.any(Function), '2026-10-14');
    expect(exists(renderer, 'terms-gate')).toBe(false);
  });

  it('does not ask an account that already accepted the current version', async () => {
    jest.mocked(getTermsStatus).mockResolvedValue(status(true));
    const renderer = await mount();
    expect(exists(renderer, 'terms-gate')).toBe(false);
  });

  it('asks again for a version the person has not accepted (the server says not accepted)', async () => {
    jest.mocked(getTermsStatus).mockResolvedValue({ currentVersion: '2027-01-01', acceptedVersion: '2026-10-14', isAccepted: false });
    const renderer = await mount();
    expect(exists(renderer, 'terms-gate')).toBe(true);
  });

  it('"나중에" closes it, and a refused content write (termsAcceptanceRequired) opens it again', async () => {
    jest.mocked(getTermsStatus).mockResolvedValue(status(false));
    const renderer = await mount();
    await press(renderer, 'terms-later');
    expect(exists(renderer, 'terms-gate')).toBe(false);

    await act(async () => {
      notifyTermsAcceptanceRequired();
    });
    expect(exists(renderer, 'terms-gate')).toBe(true);
  });

  it('asks nothing while signed out or before the account exists', async () => {
    mockAuth.isAuthenticated = false;
    jest.mocked(getTermsStatus).mockResolvedValue(status(false));
    const renderer = await mount();
    expect(getTermsStatus).not.toHaveBeenCalled();
    expect(exists(renderer, 'terms-gate')).toBe(false);
  });

  it('keeps the dialog and says so when saving the agreement fails', async () => {
    jest.mocked(getTermsStatus).mockResolvedValue(status(false));
    jest.mocked(acceptTerms).mockRejectedValue(new ApiError('unavailable'));
    const renderer = await mount();
    await press(renderer, 'terms-agree');
    await press(renderer, 'terms-accept');
    expect(exists(renderer, 'terms-error')).toBe(true);
    expect(exists(renderer, 'terms-gate')).toBe(true);
  });
});

describe('BlockedUsersScreen', () => {
  const blocked = (jupleId: string, displayName: string | null) => ({ jupleId, displayName, blockedAtUtc: '', profileImageUrl: null, profileImageVersion: null });

  async function mount() {
    let renderer!: ReactTestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = ReactTestRenderer.create(<BlockedUsersScreen />);
    });
    return renderer;
  }

  it('lists the blocked people and unblocks one', async () => {
    jest.mocked(listBlockedUsers).mockResolvedValue([blocked('AAAA2222', '철수'), blocked('BBBB3333', null)]);
    jest.mocked(unblockUser).mockResolvedValue(undefined);
    const renderer = await mount();
    expect(exists(renderer, 'blocked-user-AAAA2222')).toBe(true);
    expect(exists(renderer, 'blocked-user-BBBB3333')).toBe(true);

    await press(renderer, 'unblock-AAAA2222');
    expect(unblockUser).toHaveBeenCalledWith(expect.any(Function), 'AAAA2222');
    expect(exists(renderer, 'blocked-user-AAAA2222')).toBe(false);
    expect(exists(renderer, 'blocked-user-BBBB3333')).toBe(true);
  });

  it('says nobody is blocked, and offers a retry when the list cannot be read', async () => {
    jest.mocked(listBlockedUsers).mockResolvedValueOnce([]);
    expect(exists(await mount(), 'blocked-users-empty')).toBe(true);

    jest.mocked(listBlockedUsers).mockRejectedValueOnce(new ApiError('unavailable'));
    expect(exists(await mount(), 'blocked-users-error')).toBe(true);
  });
});
