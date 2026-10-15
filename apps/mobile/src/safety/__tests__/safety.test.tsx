import ReactTestRenderer, { act } from 'react-test-renderer';
import { ApiError } from '../../api/ApiError';
import { BlockedUsersScreen } from '../../screens/BlockedUsersScreen';
import i18n from '../../i18n';
import { ReportModal } from '../ReportModal';
import { Text } from 'react-native';
import { AppModal } from '../../components/AppModal';
import { TermsAgreementScreen } from '../TermsAgreementScreen';
import { useTermsOnboarding } from '../useTermsOnboarding';
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

const mockRequest = jest.fn();
jest.mock('../../api/useAuthenticatedApi', () => ({ useAuthenticatedApi: () => mockRequest }));
jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: ({ children }: { children: React.ReactNode }) => children,
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));
jest.mock('../../config/legalLinks', () => ({ legalLinks: { termsUrl: 'https://example.test/terms', privacyUrl: 'https://example.test/privacy' } }));
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

describe('Terms onboarding (the Agreement screen)', () => {
  const status = (accepted: boolean) => ({ currentVersion: '2026-10-14', acceptedVersion: accepted ? '2026-10-14' : null, isAccepted: accepted });

  /** The wiring RootStack does: the hook decides, the screen only shows while a decision is "required". */
  function Harness({ enabled = true }: { readonly enabled?: boolean }) {
    const onboarding = useTermsOnboarding(enabled);
    return (
      <>
        {onboarding.status === 'accepted' ? <Text testID="home">home</Text> : null}
        {onboarding.status === 'error' ? <Text testID="unavailable">error</Text> : null}
        {onboarding.status === 'required' ? (
          <TermsAgreementScreen
            isSaving={onboarding.isSaving}
            onAccept={() => { onboarding.accept().catch(() => undefined); }}
            saveFailed={onboarding.saveFailed}
          />
        ) : null}
      </>
    );
  }

  async function mount(enabled = true) {
    let renderer!: ReactTestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = ReactTestRenderer.create(<Harness enabled={enabled} />);
    });
    return renderer;
  }

  it('shows the Agreement before anything else for an account that has not accepted, with 다음 disabled', async () => {
    jest.mocked(getTermsStatus).mockResolvedValue(status(false));
    const renderer = await mount();
    expect(exists(renderer, 'terms-agreement-screen')).toBe(true);
    expect(exists(renderer, 'home')).toBe(false);
    expect(byId(renderer, 'agreement-next').props.disabled).toBe(true);
    expect(exists(renderer, 'agreement-terms-detail')).toBe(true);
    expect(exists(renderer, 'agreement-privacy-detail')).toBe(true);
  });

  it('needs BOTH required items; 전체동의 checks both; then 다음 records the server version and continues', async () => {
    jest.mocked(getTermsStatus).mockResolvedValue(status(false));
    jest.mocked(acceptTerms).mockResolvedValue(status(true));
    const renderer = await mount();

    await press(renderer, 'agreement-terms');
    expect(byId(renderer, 'agreement-next').props.disabled).toBe(true);
    await press(renderer, 'agreement-privacy');
    expect(byId(renderer, 'agreement-next').props.disabled).toBe(false);

    // Unchecking one disables it again; 전체동의 then checks both.
    await press(renderer, 'agreement-terms');
    expect(byId(renderer, 'agreement-next').props.disabled).toBe(true);
    await press(renderer, 'agreement-all');
    expect(byId(renderer, 'agreement-next').props.disabled).toBe(false);

    await press(renderer, 'agreement-next');
    expect(acceptTerms).toHaveBeenCalledWith(expect.any(Function), '2026-10-14');
    expect(acceptTerms).toHaveBeenCalledTimes(1);
    expect(exists(renderer, 'home')).toBe(true);
    expect(exists(renderer, 'terms-agreement-screen')).toBe(false);
  });

  it('opens the detail of each item', async () => {
    jest.mocked(getTermsStatus).mockResolvedValue(status(false));
    const renderer = await mount();
    const detailVisible = () => renderer.root.findByType(AppModal).props.visible;
    expect(detailVisible()).toBe(false);
    await press(renderer, 'agreement-privacy-detail');
    expect(detailVisible()).toBe(true);
    expect(exists(renderer, 'agreement-detail-full')).toBe(true);
  });

  it('has no X, skip or other way around it: the only way on is agreeing to both', async () => {
    jest.mocked(getTermsStatus).mockResolvedValue(status(false));
    const renderer = await mount();
    expect(exists(renderer, 'agreement-close')).toBe(false);
    expect(exists(renderer, 'agreement-skip')).toBe(false);
    // Every pressable the screen has: the two checkboxes, 전체동의, the two details and 다음 - nothing that leaves.
    const pressables = renderer.root
      .findAll(node => typeof node.props.testID === 'string' && typeof node.props.onPress === 'function')
      .map(node => node.props.testID as string);
    expect(new Set(pressables)).toEqual(new Set(['agreement-all', 'agreement-terms', 'agreement-privacy', 'agreement-terms-detail', 'agreement-privacy-detail', 'agreement-next']));
    expect(acceptTerms).not.toHaveBeenCalled();
    expect(exists(renderer, 'home')).toBe(false);
  });

  it('goes straight on for an account that already accepted this version (new device, re-login)', async () => {
    jest.mocked(getTermsStatus).mockResolvedValue(status(true));
    const renderer = await mount();
    expect(exists(renderer, 'home')).toBe(true);
    expect(exists(renderer, 'terms-agreement-screen')).toBe(false);
    expect(acceptTerms).not.toHaveBeenCalled();
  });

  it('asks again when the server has a newer version than the one accepted', async () => {
    jest.mocked(getTermsStatus).mockResolvedValue({ currentVersion: '2027-01-01', acceptedVersion: '2026-10-14', isAccepted: false });
    const renderer = await mount();
    expect(exists(renderer, 'terms-agreement-screen')).toBe(true);
  });

  it('asks nothing while not signed in / bootstrapped', async () => {
    const renderer = await mount(false);
    expect(getTermsStatus).not.toHaveBeenCalled();
    expect(exists(renderer, 'terms-agreement-screen')).toBe(false);
    expect(exists(renderer, 'home')).toBe(false);
  });

  it('never lets the person through when the status cannot be read', async () => {
    jest.mocked(getTermsStatus).mockRejectedValue(new ApiError('unavailable'));
    const renderer = await mount();
    expect(exists(renderer, 'unavailable')).toBe(true);
    expect(exists(renderer, 'home')).toBe(false);
  });

  it('says so and stays on the Agreement when saving fails', async () => {
    jest.mocked(getTermsStatus).mockResolvedValue(status(false));
    jest.mocked(acceptTerms).mockRejectedValue(new ApiError('unavailable'));
    const renderer = await mount();
    await press(renderer, 'agreement-all');
    await press(renderer, 'agreement-next');
    expect(exists(renderer, 'agreement-error')).toBe(true);
    expect(exists(renderer, 'terms-agreement-screen')).toBe(true);
    expect(exists(renderer, 'home')).toBe(false);
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
