import ReactTestRenderer, { act } from 'react-test-renderer';
import { AccessibilityInfo, Modal, StyleSheet, Text, View } from 'react-native';
import i18n from '../../i18n';
import { getMyProfile } from '../../api/profileApi';
import { useOptionalAuth } from '../../auth/AuthContext';
import { reportDialogOpen, resetDialogPresence } from '../../components/dialogPresence';
import { navigationRef } from '../../navigation/navigationRef';
import { getActiveTour } from '../../tour/tourController';
import { TrialEndedPrompt, resetTrialEndedPromptMemory } from '../TrialEndedPrompt';
import { WelcomeTrialPrompt } from '../WelcomeTrialPrompt';

const mockStore = new Map<string, string>();
jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(async (key: string) => mockStore.get(key) ?? null),
  setItem: jest.fn(async (key: string, value: string) => {
    mockStore.set(key, value);
  }),
}));
jest.mock('../../api/useAuthenticatedApi', () => ({ useAuthenticatedApi: () => jest.fn() }));
jest.mock('../../api/profileApi', () => ({ getMyProfile: jest.fn() }));
jest.mock('../../auth/AuthContext', () => ({ useOptionalAuth: jest.fn() }));
let mockPendingShare: { id: string } | null = null;
jest.mock('../../share/useIncomingShare', () => ({ useIncomingShare: () => ({ pendingShare: mockPendingShare }) }));
jest.mock('../../navigation/navigationRef', () => ({
  navigationRef: { isReady: jest.fn(), getRootState: jest.fn(), navigate: jest.fn(), dispatch: jest.fn() },
}));
jest.mock('../../tour/tourController', () => ({ getActiveTour: jest.fn(() => null), subscribeTour: jest.fn(() => () => undefined) }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 44, right: 0, bottom: 34, left: 0 }) }));

const nav = navigationRef as unknown as { isReady: jest.Mock; getRootState: jest.Mock; navigate: jest.Mock; dispatch: jest.Mock };
const rootTop = (name: string) => ({ index: 0, routes: [{ name }] });

const TOUR_DONE = 'juple.tour.completed.mainOnboarding.v1.JUPLE-1';
const runningTrial = {
  programEnabled: true, status: 'trial', reason: 'none', trialStartedAtUtc: '2026-11-16T00:00:00Z', trialEndsAtUtc: '2026-12-16T00:00:00Z',
  currentPeriodEndsAtUtc: null, accessFrozenAtUtc: null, canWrite: true, verifiedAtUtc: '2026-11-16T00:00:00Z',
};
const endedTrial = {
  ...runningTrial, status: 'expired', trialStartedAtUtc: '2026-10-01T00:00:00Z', trialEndsAtUtc: '2026-10-31T00:00:00Z',
  accessFrozenAtUtc: '2026-10-31T00:00:00Z', canWrite: false, verifiedAtUtc: '2026-11-16T00:00:00Z',
};
const noStore = { state: 'none', platform: null, productId: null, currentPeriodEndsAtUtc: null, autoRenewing: null, startedAtUtc: null, endedState: null, endedAtUtc: null };

function auth(values: Record<string, unknown>) {
  jest.mocked(useOptionalAuth).mockReturnValue({ storeSubscription: noStore, dataRetention: null, ...values } as never);
}

async function mount(element: React.ReactElement) {
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => {
    renderer = ReactTestRenderer.create(element);
  });
  return renderer;
}
async function tick(ms = 500) {
  await act(async () => {
    jest.advanceTimersByTime(ms);
  });
  await act(async () => {
    await Promise.resolve();
  });
  await act(async () => {
    await Promise.resolve();
  });
}
const visibleTexts = (renderer: ReactTestRenderer.ReactTestRenderer) =>
  renderer.root.findAll(node => node.type === Modal && node.props.visible === true).flatMap(modal => modal.findAllByType(Text).map(node => String(node.props.children)));
const isShown = (renderer: ReactTestRenderer.ReactTestRenderer, testID: string) =>
  renderer.root.findAll(node => node.type === Modal && node.props.visible === true).some(modal => modal.findAll(node => node.props.testID === testID).length > 0);
const pressIn = async (renderer: ReactTestRenderer.ReactTestRenderer, testID: string) => {
  const target = renderer.root.findAll(node => node.props.testID === testID && typeof node.props.onPress === 'function')[0];
  await act(async () => target.props.onPress());
};

beforeAll(async () => {
  await i18n.changeLanguage('ko');
});
beforeEach(() => {
  jest.useFakeTimers();
  mockStore.clear();
  mockPendingShare = null;
  resetDialogPresence();
  resetTrialEndedPromptMemory();
  nav.isReady.mockReturnValue(true);
  nav.getRootState.mockReturnValue(rootTop('MainTabs'));
  jest.mocked(getActiveTour).mockReturnValue(null);
  jest.mocked(getMyProfile).mockResolvedValue({ jupleId: 'JUPLE-1', displayName: null } as never);
  jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(false);
});
afterEach(() => {
  jest.useRealTimers();
  jest.clearAllMocks();
  jest.restoreAllMocks();
});

describe('WelcomeTrialPrompt - "가입해 주셔서 감사해요!", once per account, for anyone in a running free trial', () => {
  it('after the first-run tour was finished or skipped, on Home: the welcome with the requested words and one button', async () => {
    mockStore.set(TOUR_DONE, 'true');
    auth({ entitlement: runningTrial, newAccountTrialGranted: true });
    const renderer = await mount(<WelcomeTrialPrompt />);
    await tick();

    expect(isShown(renderer, 'welcome-trial')).toBe(true);
    expect(visibleTexts(renderer).join('\n')).toBe([
      '가입해 주셔서 감사해요!',
      '가입일로부터 30일간 Juple을 무료로 이용해 보세요!\n\n무료 체험이 끝난 후에도 계속 이용하고 싶다면 월간 또는 연간 멤버십을 선택할 수 있어요.',
      '닫기',
    ].join('\n'));
  });

  it('an existing member in a running trial sees it once too, with the membership-start words', async () => {
    mockStore.set(TOUR_DONE, 'true');
    auth({ entitlement: runningTrial, newAccountTrialGranted: false });
    const renderer = await mount(<WelcomeTrialPrompt />);
    await tick();
    expect(isShown(renderer, 'welcome-trial')).toBe(true);
    const text = visibleTexts(renderer).join('\n');
    expect(text).toContain('Juple 멤버십 시작일부터 30일간 무료로 이용해 보세요!');
    expect(text).toContain('월간 또는 연간 멤버십을 선택할 수 있어요.');
    expect(text).not.toContain('가입일로부터');
    await pressIn(renderer, 'welcome-trial-primary');
    expect(mockStore.get('juple.welcomeTrial.JUPLE-1')).toBe('shown');
    renderer.unmount();

    const relaunch = await mount(<WelcomeTrialPrompt />);
    await tick(3000);
    expect(isShown(relaunch, 'welcome-trial')).toBe(false);
  });

  it('waits while the first-run tour is still to come or running, then shows', async () => {
    auth({ entitlement: runningTrial, newAccountTrialGranted: true });
    jest.mocked(getActiveTour).mockReturnValue({ guide: {}, index: 0, userKey: 'JUPLE-1' } as never);
    const renderer = await mount(<WelcomeTrialPrompt />);
    await tick(3000);
    expect(isShown(renderer, 'welcome-trial')).toBe(false);

    // Skipped (or finished): the tour records itself as seen and goes away.
    jest.mocked(getActiveTour).mockReturnValue(null);
    mockStore.set(TOUR_DONE, 'true');
    await tick();
    expect(isShown(renderer, 'welcome-trial')).toBe(true);
  });

  it('waits while another screen is in front, a share is pending, or another popup (the app update) is up', async () => {
    mockStore.set(TOUR_DONE, 'true');
    auth({ entitlement: runningTrial, newAccountTrialGranted: true });
    nav.getRootState.mockReturnValue(rootTop('SharedCollection'));
    reportDialogOpen('appUpdate', true);
    const renderer = await mount(<WelcomeTrialPrompt />);
    await tick(2000);
    expect(isShown(renderer, 'welcome-trial')).toBe(false);
    nav.getRootState.mockReturnValue(rootTop('MainTabs'));
    await tick(2000);
    expect(isShown(renderer, 'welcome-trial')).toBe(false);
    reportDialogOpen('appUpdate', false);
    await tick();
    expect(isShown(renderer, 'welcome-trial')).toBe(true);
  });

  it('closing it (button, Back or a tap outside) records it: the next launch and the server\'s later "false" never bring it back', async () => {
    mockStore.set(TOUR_DONE, 'true');
    auth({ entitlement: runningTrial, newAccountTrialGranted: true });
    const first = await mount(<WelcomeTrialPrompt />);
    await tick();
    await pressIn(first, 'welcome-trial-primary');
    expect(isShown(first, 'welcome-trial')).toBe(false);
    expect(mockStore.get('juple.welcomeTrial.JUPLE-1')).toBe('shown');
    // The Home "your free period started" card for the same period is closed too - not told twice.
    expect(mockStore.has('juple.trialNotice.welcome.2026-12-16T00:00:00Z')).toBe(true);
    first.unmount();

    auth({ entitlement: runningTrial, newAccountTrialGranted: false });
    const relaunch = await mount(<WelcomeTrialPrompt />);
    await tick(3000);
    expect(isShown(relaunch, 'welcome-trial')).toBe(false);
  });

  it('Back / a tap outside only closes it, the same as the button', async () => {
    mockStore.set(TOUR_DONE, 'true');
    auth({ entitlement: runningTrial, newAccountTrialGranted: true });
    const renderer = await mount(<WelcomeTrialPrompt />);
    await tick();
    await pressIn(renderer, 'welcome-trial-backdrop');
    expect(isShown(renderer, 'welcome-trial')).toBe(false);
    expect(nav.navigate).not.toHaveBeenCalled();
    expect(mockStore.get('juple.welcomeTrial.JUPLE-1')).toBe('shown');
  });

  it('the app closed before Home appeared: the next launch (server now says false) still shows it, once', async () => {
    auth({ entitlement: runningTrial, newAccountTrialGranted: true });
    nav.getRootState.mockReturnValue(rootTop('TermsAgreement'));
    const first = await mount(<WelcomeTrialPrompt />);
    await tick(1000);
    expect(isShown(first, 'welcome-trial')).toBe(false);
    first.unmount();

    mockStore.set(TOUR_DONE, 'true');
    nav.getRootState.mockReturnValue(rootTop('MainTabs'));
    auth({ entitlement: runningTrial, newAccountTrialGranted: false });
    const relaunch = await mount(<WelcomeTrialPrompt />);
    await tick();
    expect(isShown(relaunch, 'welcome-trial')).toBe(true);
  });

  it('nobody outside a running trial sees it (a subscriber or an expired account), and nothing is recorded', async () => {
    mockStore.set(TOUR_DONE, 'true');
    for (const entitlement of [{ ...runningTrial, status: 'active' }, endedTrial]) {
      auth({ entitlement, newAccountTrialGranted: false });
      const renderer = await mount(<WelcomeTrialPrompt />);
      await tick(3000);
      expect(isShown(renderer, 'welcome-trial')).toBe(false);
      renderer.unmount();
    }
    expect(mockStore.has('juple.welcomeTrial.JUPLE-1')).toBe(false);
  });

  it('never promises a free month that is not running (program off or no trial at display time)', async () => {
    mockStore.set(TOUR_DONE, 'true');
    auth({ entitlement: { ...runningTrial, programEnabled: false, status: null }, newAccountTrialGranted: true });
    const renderer = await mount(<WelcomeTrialPrompt />);
    await tick(3000);
    expect(isShown(renderer, 'welcome-trial')).toBe(false);
  });

  it('long words scroll inside the card, which stays inside the safe area', async () => {
    mockStore.set(TOUR_DONE, 'true');
    auth({ entitlement: runningTrial, newAccountTrialGranted: true });
    const renderer = await mount(<WelcomeTrialPrompt />);
    await tick();
    const modal = renderer.root.findAll(node => node.type === Modal && node.props.visible === true)[0];
    expect(modal.findAll(node => (node.type as { displayName?: string }).displayName === 'ScrollView' || String(node.type).includes('ScrollView')).length).toBeGreaterThan(0);
    const overlay = modal.findAll(node => typeof node.type === 'string' && node.props.style && JSON.stringify(node.props.style).includes('"paddingTop":60'));
    expect(overlay.length).toBeGreaterThan(0);
  });
});

describe('TrialEndedPrompt - "how was your month with Juple?"', () => {
  it('when the server says the free month ended and nothing is live: the requested words, 구독하러 가기 and 나중에', async () => {
    auth({ entitlement: endedTrial });
    const renderer = await mount(<TrialEndedPrompt />);
    await tick();

    expect(isShown(renderer, 'trial-ended')).toBe(true);
    const texts = visibleTexts(renderer);
    expect(texts).toContain('Juple과 함께한 한 달, 어떠셨나요? 💜');
    expect(texts.join('\n')).toBe([
      'Juple과 함께한 한 달, 어떠셨나요? 💜',
      '지난 한 달 동안 Juple을 이용해 주셔서 감사합니다!\n\n무료 이용 기간이 종료되었어요.\n\n지금까지 저장한 링크와 컬렉션은 그대로 보관되며, 언제든 다시 확인할 수 있습니다.\n\n앞으로도 새로운 링크를 저장하고 컬렉션을 관리하고 싶다면 멤버십을 구독해 주세요.',
      '나중에',
      '구독하러 가기',
    ].join('\n'));
    expect(texts).toEqual(expect.arrayContaining(['구독하러 가기', '나중에']));
  });

  it('나중에 only closes it - not again in this run, but again on the next launch while it still applies', async () => {
    auth({ entitlement: endedTrial });
    const renderer = await mount(<TrialEndedPrompt />);
    await tick();
    await pressIn(renderer, 'trial-ended-secondary');
    expect(isShown(renderer, 'trial-ended')).toBe(false);
    expect(nav.navigate).not.toHaveBeenCalled();
    expect(nav.dispatch).not.toHaveBeenCalled();

    // Same process: a remount (e.g. after a sign-in refresh) does not repeat it.
    renderer.unmount();
    const again = await mount(<TrialEndedPrompt />);
    await tick(3000);
    expect(isShown(again, 'trial-ended')).toBe(false);
    again.unmount();

    // A new launch (a new process) asks again.
    resetTrialEndedPromptMemory();
    const nextLaunch = await mount(<TrialEndedPrompt />);
    await tick();
    expect(isShown(nextLaunch, 'trial-ended')).toBe(true);
  });

  it('Back / a tap outside is the same as 나중에: nothing bought, cancelled or changed', async () => {
    auth({ entitlement: endedTrial });
    const renderer = await mount(<TrialEndedPrompt />);
    await tick();
    await pressIn(renderer, 'trial-ended-backdrop');
    expect(isShown(renderer, 'trial-ended')).toBe(false);
    expect(nav.navigate).not.toHaveBeenCalled();
    const modal = renderer.root.findAll(node => node.type === Modal)[0];
    await act(async () => modal.props.onRequestClose());
    expect(nav.navigate).not.toHaveBeenCalled();
  });

  it('구독하러 가기 opens 내 페이지 and the Membership screen on top of it', async () => {
    auth({ entitlement: endedTrial });
    const renderer = await mount(<TrialEndedPrompt />);
    await tick();
    await pressIn(renderer, 'trial-ended-primary');

    expect(isShown(renderer, 'trial-ended')).toBe(false);
    expect(nav.navigate.mock.calls).toEqual([['MainTabs', { screen: 'MyPage' }], ['Subscription']]);
  });

  it('a subscription verified while it is open closes it', async () => {
    auth({ entitlement: endedTrial });
    const renderer = await mount(<TrialEndedPrompt />);
    await tick();
    expect(isShown(renderer, 'trial-ended')).toBe(true);

    auth({ entitlement: { ...endedTrial, status: 'active', accessFrozenAtUtc: null, canWrite: true }, storeSubscription: { ...noStore, state: 'active', platform: 'apple' } });
    await act(async () => renderer.update(<TrialEndedPrompt />));
    expect(isShown(renderer, 'trial-ended')).toBe(false);
  });

  it('never for a running trial, a lapsed PAID subscription, a live subscription or while the program is off', async () => {
    for (const values of [
      { entitlement: runningTrial },
      { entitlement: { ...endedTrial, accessFrozenAtUtc: '2026-11-30T00:00:00Z' }, storeSubscription: { ...noStore, endedState: 'expired', endedAtUtc: '2026-11-30T00:00:00Z' } },
      { entitlement: { ...endedTrial, status: 'active', accessFrozenAtUtc: null }, storeSubscription: { ...noStore, state: 'active', platform: 'google' } },
      { entitlement: { ...endedTrial, programEnabled: false, status: null } },
    ]) {
      auth(values);
      const renderer = await mount(<TrialEndedPrompt />);
      await tick(2000);
      expect(isShown(renderer, 'trial-ended')).toBe(false);
      renderer.unmount();
    }
  });

  it('when the retention policy is in effect, the server\'s keep-until date is added to the words', async () => {
    auth({ entitlement: endedTrial, dataRetention: { phase: 'readOnly', basis: 'trialEnded', accessEndedAtUtc: '2026-10-31T00:00:00Z', deletionScheduledAtUtc: '2027-10-31T00:00:00Z', nextNoticeAtUtc: null, readOnly: true } });
    const renderer = await mount(<TrialEndedPrompt />);
    await tick();
    expect(visibleTexts(renderer).join('\n')).toMatch(/2027/);
  });

  it('waits for Home and for another popup to be gone', async () => {
    auth({ entitlement: endedTrial });
    reportDialogOpen('welcomeTrial', true);
    nav.getRootState.mockReturnValue(rootTop('Subscription'));
    const renderer = await mount(<TrialEndedPrompt />);
    await tick(2000);
    expect(isShown(renderer, 'trial-ended')).toBe(false);
    nav.getRootState.mockReturnValue(rootTop('MainTabs'));
    reportDialogOpen('welcomeTrial', false);
    await tick();
    expect(isShown(renderer, 'trial-ended')).toBe(true);
  });
});

describe('the popups in other languages and with Reduce Motion', () => {
  it.each(['en', 'ja', 'ar', 'de', 'ru'])('%s: translated words, no Korean left', async language => {
    await i18n.changeLanguage(language);
    try {
      mockStore.set(TOUR_DONE, 'true');
      auth({ entitlement: runningTrial, newAccountTrialGranted: true });
      const renderer = await mount(<WelcomeTrialPrompt />);
      await tick();
      const text = visibleTexts(renderer).join('\n');
      expect(text).toContain(i18n.t('welcomeTrial.thanksTitle'));
      expect(text).toContain(i18n.t('welcomeTrial.newMemberBody'));
      expect(text).toContain(i18n.t('welcomeTrial.plansAfterTrial'));
      expect(text).not.toMatch(/[가-힣]/);
    } finally {
      await i18n.changeLanguage('ko');
    }
  });

  it('with Reduce Motion the card is simply there (no entrance animation)', async () => {
    jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(true);
    mockStore.set(TOUR_DONE, 'true');
    auth({ entitlement: runningTrial, newAccountTrialGranted: true });
    const renderer = await mount(<WelcomeTrialPrompt />);
    await tick();
    const card = renderer.root.findAll(node => node.props.testID === 'welcome-trial' && typeof node.type === 'string')[0];
    // The animated value sits at its end state at once.
    expect(StyleSheet.flatten(card.props.style).opacity).toBe(1);
  });
});

describe('one popup at a time (iOS presents one modal at a time)', () => {
  it('a refused change while the free-month-ended popup is up waits, then shows once that popup is gone', async () => {
    const { SubscriptionRequiredPrompt } = jest.requireActual('../SubscriptionRequiredPrompt') as typeof import('../SubscriptionRequiredPrompt');
    const { notifySubscriptionRequired } = jest.requireActual('../subscriptionRequired') as typeof import('../subscriptionRequired');
    auth({ entitlement: endedTrial });
    const renderer = await mount(
      <View>
        <TrialEndedPrompt />
        <SubscriptionRequiredPrompt />
      </View>,
    );
    await tick();
    expect(isShown(renderer, 'trial-ended')).toBe(true);

    await act(async () => notifySubscriptionRequired('actor'));
    const refusalVisible = () => renderer.root.findAll(node => node.type === Modal && node.props.visible === true)
      .some(modal => modal.findAllByType(Text).some(text => text.props.children === '멤버십이 필요한 기능이에요'));
    expect(refusalVisible()).toBe(false);

    await pressIn(renderer, 'trial-ended-secondary');
    expect(isShown(renderer, 'trial-ended')).toBe(false);
    expect(refusalVisible()).toBe(true);
  });

  it('while the membership prompt is up, the free-month-ended popup waits for it', async () => {
    const { SubscriptionRequiredPrompt } = jest.requireActual('../SubscriptionRequiredPrompt') as typeof import('../SubscriptionRequiredPrompt');
    const { notifySubscriptionRequired } = jest.requireActual('../subscriptionRequired') as typeof import('../subscriptionRequired');
    auth({ entitlement: endedTrial });
    nav.getRootState.mockReturnValue(rootTop('Subscription'));
    const renderer = await mount(
      <View>
        <TrialEndedPrompt />
        <SubscriptionRequiredPrompt />
      </View>,
    );
    await act(async () => notifySubscriptionRequired('actor'));
    nav.getRootState.mockReturnValue(rootTop('MainTabs'));
    await tick(2000);
    expect(isShown(renderer, 'trial-ended')).toBe(false);
  });
});
