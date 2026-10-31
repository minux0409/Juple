import ReactTestRenderer, { act } from 'react-test-renderer';
import { ApiError } from '../../api/ApiError';
import i18n from '../../i18n';
import { ReportModal } from '../ReportModal';
import { StyleSheet, Text } from 'react-native';
import { AppModal } from '../../components/AppModal';
import { colors } from '../../theme/tokens';
import { TermsAgreementScreen } from '../TermsAgreementScreen';
import { useTermsOnboarding } from '../useTermsOnboarding';
import {
  acceptTerms,
  blockedInteractionKey,
  getTermsStatus,
  isTermsRequiredError,
  parseBlockedUsers,
  parseTermsStatus,
  reportBody,
  REPORT_REASONS,
  submitReport,
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
    expect(reportBody({ type: 'Collection', collectionId: 4 }, 'Spam', ' why ')).toEqual({ targetType: 'Collection', targetId: '4', reason: 'Spam', details: 'why' });
    expect(reportBody({ type: 'Item', itemId: 9, collectionId: 4 }, 'Other', '')).toEqual({ targetType: 'Item', targetId: '9', collectionId: 4, reason: 'Other' });
    expect(reportBody({ type: 'Comment', commentId: 7 }, 'Harassment', '')).toEqual({ targetType: 'Comment', targetId: '7', reason: 'Harassment' });
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

    await press(renderer, 'report-reason-Other');
    await act(async () => {
      renderer.root.find(node => node.props.testID === 'report-details' && typeof node.props.onChangeText === 'function').props.onChangeText('a bad link');
    });
    await press(renderer, 'report-submit');

    expect(submitReport).toHaveBeenCalledWith(expect.any(Function), { type: 'Comment', commentId: 7 }, 'Other', 'a bad link');
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

  it('the footer takes the whole row AppModal gives it, and 취소 / 신고하기 are the confirm dialogs\' equal-halves buttons (never zero-width bars)', async () => {
    let renderer!: ReactTestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = ReactTestRenderer.create(<ReportModal onClose={jest.fn()} onReported={jest.fn()} target={{ type: 'Item', itemId: 3, collectionId: 5 }} />);
    });
    // AppModal lays its footer out in a row: a wrapper without flex: 1 shrinks to its content and collapses flexBasis-0 buttons to nothing.
    const footer = renderer.root.findByType(AppModal).props.footer;
    expect(StyleSheet.flatten(footer.props.style).flex).toBe(1);

    const flat = (testID: string) => StyleSheet.flatten(byId(renderer, testID).props.style);
    for (const testID of ['report-cancel', 'report-submit']) {
      expect(flat(testID)).toMatchObject({ flexBasis: 0, flexGrow: 1, minWidth: 0, minHeight: 44 });
    }
    expect(flat('report-cancel').backgroundColor).not.toBe(flat('report-submit').backgroundColor);
    expect(flat('report-submit').backgroundColor).toBe(colors.brand);
    expect(renderer.root.findAll(node => node.type === Text).map(node => node.props.children)).toEqual(expect.arrayContaining([i18n.t('common.cancel'), i18n.t('safety.reportSubmit')]));
    // The explanation field grows to a limit and then scrolls inside itself - it never pushes the buttons out.
    expect(StyleSheet.flatten(renderer.root.find(node => node.props.testID === 'report-details' && typeof node.props.onChangeText === 'function').props.style).maxHeight).toBe(160);
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

  it('lines up every check box: 전체동의 and each single agreement start their box at the same inset (one vertical line)', async () => {
    jest.mocked(getTermsStatus).mockResolvedValue(status(false));
    const renderer = await mount();
    const leading = (testID: string) => {
      const node = renderer.root.findAll(candidate => candidate.props.testID === testID && typeof candidate.type === 'string')[0];
      const style = StyleSheet.flatten(node.props.style);
      return style.paddingStart ?? style.paddingHorizontal ?? style.paddingLeft ?? 0;
    };
    const all = leading('agreement-all');
    expect(all).toBeGreaterThan(0);
    for (const testID of ['agreement-terms', 'agreement-privacy', 'agreement-age']) {
      expect(leading(testID)).toBe(all);
    }
  });

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
    expect(byId(renderer, 'agreement-next').props.disabled).toBe(true);
    await press(renderer, 'agreement-age');
    expect(byId(renderer, 'agreement-next').props.disabled).toBe(false);
    await press(renderer, 'agreement-age');
    expect(byId(renderer, 'agreement-next').props.disabled).toBe(true);
    await press(renderer, 'agreement-age');

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
    expect(new Set(pressables)).toEqual(new Set(['agreement-all', 'agreement-terms', 'agreement-privacy', 'agreement-age', 'agreement-age-detail', 'agreement-terms-detail', 'agreement-privacy-detail', 'agreement-next']));
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

  it('requires a legacy member to confirm the new age policy once, then stays accepted after restart', async () => {
    const current = { currentVersion: '2026-10-25', acceptedVersion: '2026-10-25', isAccepted: true };
    jest.mocked(getTermsStatus).mockResolvedValueOnce({ ...current, acceptedVersion: '2026-10-14', isAccepted: false }).mockResolvedValue(current);
    jest.mocked(acceptTerms).mockResolvedValue(current);
    const first = await mount();
    expect(exists(first, 'home')).toBe(false);
    await press(first, 'agreement-terms');
    await press(first, 'agreement-privacy');
    expect(byId(first, 'agreement-next').props.disabled).toBe(true);
    await press(first, 'agreement-age');
    await press(first, 'agreement-next');
    expect(acceptTerms).toHaveBeenCalledWith(expect.any(Function), '2026-10-25');
    expect(exists(first, 'home')).toBe(true);
    await act(async () => first.unmount());
    const restarted = await mount();
    expect(exists(restarted, 'home')).toBe(true);
    expect(exists(restarted, 'terms-agreement-screen')).toBe(false);
    expect(acceptTerms).toHaveBeenCalledTimes(1);
  });

  it('does not treat a malformed acceptance response as a successful age confirmation', async () => {
    const actual = jest.requireActual('../safetyApi') as typeof import('../safetyApi');
    const request = jest.fn().mockResolvedValue({ body: {} });
    await expect(actual.acceptTerms(request, '2026-10-25')).rejects.toThrow();
    expect(request).toHaveBeenCalledWith(expect.objectContaining({ body: { version: '2026-10-25', isAtLeast14: true } }));
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

  it('offers a fresh status retry instead of repeatedly submitting an obsolete policy version', async () => {
    jest.mocked(getTermsStatus).mockResolvedValue(status(false));
    jest.mocked(acceptTerms).mockRejectedValue(new ApiError('badRequest', 400));
    const renderer = await mount();
    await press(renderer, 'agreement-all');
    await press(renderer, 'agreement-next');
    expect(exists(renderer, 'unavailable')).toBe(true);
    expect(exists(renderer, 'terms-agreement-screen')).toBe(false);
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

describe('shared Collection reports and the blocked list', () => {
  it('offers the five reasons of the policy, each with a label in every language', () => {
    expect(REPORT_REASONS).toEqual(['Spam', 'SexualOrInappropriate', 'Harassment', 'IntellectualProperty', 'Other']);
  });

  it('a public link is reported through the link: no internal id travels, the path carries the encoded public id', async () => {
    const request = jest.fn().mockResolvedValue({ body: { alreadyReported: false } });
    const { submitReport: actualSubmit } = jest.requireActual<typeof import('../safetyApi')>('../safetyApi');
    await actualSubmit(request as never, { type: 'PublicShare', publicId: 'a/b' }, 'Spam', ' why ');
    expect(request).toHaveBeenCalledWith({ method: 'POST', path: '/api/v1/public-shares/a%2Fb/reports', body: { reason: 'Spam', details: 'why' } });
  });

  it('a blocked person carries the hidden Collections I can still open; a malformed entry is dropped', () => {
    const [person] = parseBlockedUsers({ items: [{ jupleId: 'ABC', hiddenCollections: [{ id: 7, name: 'Trip' }, { id: 'x', name: 'bad' }, null] }] });
    expect(person.hiddenCollections).toEqual([{ id: 7, name: 'Trip' }]);
    expect(parseBlockedUsers({ items: [{ jupleId: 'ABC' }] })[0].hiddenCollections).toEqual([]);
  });

  it('every language has every new string, and the block question keeps its name placeholder', () => {
    const locales = ['ar', 'de', 'en', 'es', 'fr', 'hi', 'id', 'it', 'ja', 'ko', 'pt-BR', 'ru', 'th', 'tr', 'vi', 'zh-Hans', 'zh-Hant'];
    for (const locale of locales) {
      const safety = require(`../../i18n/locales/${locale}.json`).safety as Record<string, string>;
      for (const key of ['reportCollection', 'reportLink', 'reportTargetLabel', 'blockUserAction', 'unblockMessage', 'hiddenCollectionsTitle', 'shareRestrictedNotice']) {
        expect(safety[key]?.length).toBeGreaterThan(0);
      }
      // The short question: no placeholder, no long list of effects - only where to undo the block.
      expect(safety.blockConfirmMessage).not.toContain('{{name}}');
      expect(safety.blockConfirmMessage.length).toBeLessThan(140);
      expect(safety.unblockTitle).toContain('{{name}}');
      expect(safety.blockedAt).toContain('{{date}}');
      for (const reason of REPORT_REASONS) {
        expect(safety[`reason${reason}`]?.length).toBeGreaterThan(0);
      }
    }
  });
});
