import ReactTestRenderer, { act } from 'react-test-renderer';
import { Modal, Text } from 'react-native';
import i18n from '../../i18n';
import { SubscriptionScreen } from '../SubscriptionScreen';
import { useAuth } from '../../auth/AuthContext';
import type { SubscriptionStore } from '../../billing/subscriptionStore';
import { useSubscriptionStore } from '../../billing/useSubscriptionStore';

// The shared screen must not reach Google-only code: if it (or anything it imports) loaded either module, these factories throw.
jest.mock('react-native-iap', () => {
  throw new Error('The shared Subscription screen must not depend on react-native-iap.');
});
jest.mock('../../billing/googleBilling', () => {
  throw new Error('The shared Subscription screen must not depend on the Google billing module.');
});
jest.mock('../../billing/useSubscriptionStore', () => ({ useSubscriptionStore: jest.fn() }));
jest.mock('../../auth/AuthContext', () => ({ useAuth: jest.fn() }));
jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: ({ children }: { children: React.ReactNode }) => children,
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));

const readyOffer = { kind: 'ready', offer: { localizedPrice: '$0.99', currencyCode: 'USD', billingPeriod: 'P1M' } } as const;

let store: jest.Mocked<SubscriptionStore>;

function mockAuth(entitlement: unknown = null, storeSubscription: unknown = null) {
  jest.mocked(useAuth).mockReturnValue({ entitlement, storeSubscription } as unknown as ReturnType<typeof useAuth>);
}

beforeAll(async () => {
  await i18n.changeLanguage('en');
});
beforeEach(() => {
  store = { loadOffer: jest.fn().mockResolvedValue(readyOffer), purchase: jest.fn(), restore: jest.fn(), canManageSubscription: true, openSubscriptionManagement: jest.fn().mockResolvedValue(undefined) };
  jest.mocked(useSubscriptionStore).mockReturnValue(store);
  mockAuth();
});
afterEach(() => jest.clearAllMocks());

async function renderScreen() {
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => {
    renderer = ReactTestRenderer.create(<SubscriptionScreen />);
  });
  return renderer;
}
const byId = (renderer: ReactTestRenderer.ReactTestRenderer, testID: string) =>
  renderer.root.findAll(node => node.props.testID === testID && typeof node.props.onPress === 'function');
const texts = (renderer: ReactTestRenderer.ReactTestRenderer) => renderer.root.findAllByType(Text).map(node => String(node.props.children));
const openDialogTexts = (renderer: ReactTestRenderer.ReactTestRenderer) =>
  renderer.root
    .findAll(node => node.type === Modal && node.props.visible === true)
    .flatMap(modal => modal.findAllByType(Text).map(node => String(node.props.children)));
const press = async (renderer: ReactTestRenderer.ReactTestRenderer, testID: string) => {
  await act(async () => {
    byId(renderer, testID)[0].props.onPress();
  });
};

describe('SubscriptionScreen', () => {
  it('shows the monthly plan with the price exactly as the store localized it', async () => {
    const renderer = await renderScreen();

    expect(texts(renderer)).toEqual(expect.arrayContaining([i18n.t('subscription.planName'), i18n.t('subscription.cadence'), i18n.t('subscription.cancelNote')]));
    expect(texts(renderer).join('|')).toContain('$0.99 / month');
    expect(byId(renderer, 'subscription-subscribe')[0].props.disabled).toBe(false);
  });

  it('shows whatever the store returned - another currency is shown as-is, never swapped for a built-in price', async () => {
    store.loadOffer.mockResolvedValue({ kind: 'ready', offer: { localizedPrice: '₩1,300', currencyCode: 'KRW', billingPeriod: 'P1M' } });
    const text = texts(await renderScreen()).join('|');
    expect(text).toContain('₩1,300');
    expect(text).not.toContain('$0.99');
  });

  it('has no price and no way to subscribe when the store has none - a recoverable retry, not a hardcoded fallback', async () => {
    store.loadOffer.mockResolvedValue({ kind: 'unavailable', reason: 'productNotFound' });
    const renderer = await renderScreen();

    expect(renderer.root.findAll(node => node.props.testID === 'subscription-price')).toHaveLength(0);
    expect(texts(renderer).join('|')).not.toMatch(/\$|₩/);
    expect(texts(renderer)).toContain(i18n.t('subscription.unavailable.product'));
    expect(byId(renderer, 'subscription-subscribe')[0].props.disabled).toBe(true);

    store.loadOffer.mockResolvedValue(readyOffer);
    const retry = renderer.root.findAll(node => node.props.testID === 'subscription-unavailable' && typeof node.props.onRetry === 'function')[0]
      ?? renderer.root.findAll(node => typeof node.props.onRetry === 'function')[0];
    await act(async () => retry.props.onRetry());
    expect(store.loadOffer).toHaveBeenCalledTimes(2);
    expect(texts(renderer).join('|')).toContain('$0.99');
  });

  it('a disabled catalog is a notice, a store failure is the standard load failure - both recoverable', async () => {
    store.loadOffer.mockResolvedValue({ kind: 'unavailable', reason: 'disabled' });
    expect(texts(await renderScreen())).toContain(i18n.t('subscription.unavailable.disabled'));

    store.loadOffer.mockResolvedValue({ kind: 'unavailable', reason: 'storeUnavailable' });
    const renderer = await renderScreen();
    expect(renderer.root.findAll(node => node.props.testID === 'subscription-unavailable').length).toBeGreaterThan(0);
  });

  it('Subscribe starts the store purchase; the verified result is said, and nothing is claimed beforehand', async () => {
    store.purchase.mockResolvedValue({ kind: 'verified', state: 'active' });
    const renderer = await renderScreen();
    expect(store.purchase).not.toHaveBeenCalled();

    await press(renderer, 'subscription-subscribe');

    expect(store.purchase).toHaveBeenCalledTimes(1);
    expect(openDialogTexts(renderer)).toContain(i18n.t('subscription.result.verified'));
  });

  it('a purchase the person cancelled is not an error: no dialog at all', async () => {
    store.purchase.mockResolvedValue({ kind: 'cancelled' });
    const renderer = await renderScreen();

    await press(renderer, 'subscription-subscribe');

    expect(openDialogTexts(renderer)).toEqual([]);
    expect(byId(renderer, 'subscription-subscribe')[0].props.disabled).toBe(false);
  });

  it('a purchase the server could not confirm says so plainly - no raw error, token or code', async () => {
    store.purchase.mockResolvedValue({ kind: 'verificationFailed', reason: 'temporary' });
    const renderer = await renderScreen();

    await press(renderer, 'subscription-subscribe');

    expect(openDialogTexts(renderer)).toContain(i18n.t('subscription.result.temporary'));
  });

  it('Restore purchases runs the store restore (verified by the Backend) and reports its outcome', async () => {
    store.restore.mockResolvedValue({ kind: 'nothingFound' });
    const renderer = await renderScreen();

    await press(renderer, 'subscription-restore');

    expect(store.restore).toHaveBeenCalledTimes(1);
    expect(store.purchase).not.toHaveBeenCalled();
    expect(openDialogTexts(renderer)).toContain(i18n.t('subscription.restoreResult.nothingFound'));
  });

  it('an unexpected store exception becomes a plain message, not a crash', async () => {
    store.purchase.mockRejectedValue(new Error('boom'));
    const renderer = await renderScreen();

    await press(renderer, 'subscription-subscribe');

    expect(openDialogTexts(renderer)).toContain(i18n.t('subscription.result.failed'));
  });

  const NOW = '2026-10-01T00:00:00Z';
  const entitlementOf = (overrides: Record<string, unknown>) => ({
    programEnabled: true, status: 'trial', reason: null, trialStartedAtUtc: '2026-09-20T00:00:00Z', trialEndsAtUtc: '2026-10-20T00:00:00Z',
    currentPeriodEndsAtUtc: null, accessFrozenAtUtc: null, canWrite: true, verifiedAtUtc: NOW, ...overrides,
  });
  const accessNodes = (renderer: ReactTestRenderer.ReactTestRenderer, testID: string) =>
    renderer.root.findAll(node => node.props.testID === testID && node.type === Text);
  const details = (renderer: ReactTestRenderer.ReactTestRenderer) => accessNodes(renderer, 'subscription-access-detail').map(node => String(node.props.children));
  const accessOf = async (entitlement: unknown) => {
    mockAuth(entitlement);
    const renderer = await renderScreen();
    return { renderer, label: accessNodes(renderer, 'subscription-access')[0].props.children as string };
  };

  it('program off: "not required yet", never active, no countdown', async () => {
    const { renderer, label } = await accessOf(entitlementOf({ programEnabled: false, status: null, trialEndsAtUtc: null }));
    expect(label).toBe(i18n.t('subscription.access.inactive'));
    expect(details(renderer)).toEqual([]);
  });

  it('no entitlement yet is shown conservatively as unknown - not as free, active or inactive', async () => {
    const { renderer, label } = await accessOf(null);
    expect(label).toBe(i18n.t('subscription.access.unknown'));
    expect(details(renderer)).toEqual([]);
  });

  it('active trial: free access, remaining days from the SERVER timestamps, and the end date', async () => {
    const { renderer, label } = await accessOf(entitlementOf({}));
    expect(label).toBe(i18n.t('subscription.access.trial'));
    expect(details(renderer)[0]).toBe(i18n.t('subscription.detail.trialDaysLeft', { days: 19 }));
    expect(details(renderer)[1]).toContain(new Intl.DateTimeFormat('en', { dateStyle: 'medium' }).format(new Date('2026-10-20T00:00:00Z')));
    expect(byId(renderer, 'subscription-subscribe')).toHaveLength(1);
  });

  it('the remaining time ignores the device clock: it is trialEnds minus the server verification time', async () => {
    jest.useFakeTimers({ now: new Date('2030-01-01T00:00:00Z') });
    try {
      const { renderer } = await accessOf(entitlementOf({}));
      expect(details(renderer)[0]).toBe(i18n.t('subscription.detail.trialDaysLeft', { days: 19 }));
    } finally {
      jest.useRealTimers();
    }
  });

  it('the final partial day says "less than 1 day", not 0 days', async () => {
    const { renderer } = await accessOf(entitlementOf({ verifiedAtUtc: '2026-10-19T06:00:00Z' }));
    expect(details(renderer)[0]).toBe(i18n.t('subscription.detail.trialLessThanDay'));
  });

  it('a trial without a server verification time shows the end date but no day count', async () => {
    const { renderer } = await accessOf(entitlementOf({ verifiedAtUtc: null }));
    expect(details(renderer)).toHaveLength(1);
    expect(details(renderer)[0]).toContain('2026');
  });

  it('active subscription: no Subscribe button, store management offered, and no invented renewal date', async () => {
    const { renderer, label } = await accessOf(entitlementOf({ status: 'active', currentPeriodEndsAtUtc: '2026-11-05T00:00:00Z', trialEndsAtUtc: null }));
    expect(label).toBe(i18n.t('subscription.access.active'));
    expect(details(renderer)).toEqual([i18n.t('subscription.detail.activeManage')]);
    expect(texts(renderer).join('|')).not.toMatch(/Nov 5|2026-11|11\/5/);
    expect(byId(renderer, 'subscription-subscribe')).toHaveLength(0);
    await press(renderer, 'subscription-manage');
    expect(store.openSubscriptionManagement).toHaveBeenCalledTimes(1);
    expect(store.purchase).not.toHaveBeenCalled();
  });

  it('the manage action is absent when the store has no management page, and a failure to open it is a plain message', async () => {
    store.canManageSubscription = false;
    const absent = (await accessOf(entitlementOf({ status: 'active' }))).renderer;
    expect(byId(absent, 'subscription-manage')).toHaveLength(0);

    store.canManageSubscription = true;
    store.openSubscriptionManagement.mockRejectedValue(new Error('no store'));
    const renderer = (await accessOf(entitlementOf({ status: 'active' }))).renderer;
    await press(renderer, 'subscription-manage');
    expect(openDialogTexts(renderer)).toContain(i18n.t('subscription.manageFailed'));
  });

  it('grace period: still subscribed, asks to check the payment method, manage offered', async () => {
    const { renderer, label } = await accessOf(entitlementOf({ status: 'gracePeriod', reason: 'billingIssue' }));
    expect(label).toBe(i18n.t('subscription.access.gracePeriod'));
    expect(details(renderer)).toEqual([i18n.t('subscription.detail.grace')]);
    expect(byId(renderer, 'subscription-manage')).toHaveLength(1);
    expect(byId(renderer, 'subscription-subscribe')).toHaveLength(0);
  });

  it('expired: data kept and readable, Subscribe is the primary action, restore stays, no manage', async () => {
    const { renderer, label } = await accessOf(entitlementOf({ status: 'expired', accessFrozenAtUtc: '2026-10-20T00:00:00Z', canWrite: false }));
    expect(label).toBe(i18n.t('subscription.access.expired'));
    expect(details(renderer)).toContain(i18n.t('subscription.detail.expired'));
    expect(byId(renderer, 'subscription-subscribe')).toHaveLength(1);
    expect(byId(renderer, 'subscription-restore')).toHaveLength(1);
    expect(byId(renderer, 'subscription-manage')).toHaveLength(0);
  });

  it('the server entitlement wins: a verified purchase result does not change the shown state by itself', async () => {
    store.purchase.mockResolvedValue({ kind: 'verified', state: 'active' });
    const { renderer } = await accessOf(entitlementOf({ status: 'expired', accessFrozenAtUtc: '2026-10-20T00:00:00Z' }));
    await press(renderer, 'subscription-subscribe');
    expect(accessNodes(renderer, 'subscription-access')[0].props.children).toBe(i18n.t('subscription.access.expired'));
  });

  it('shows the 30-day information as product information, separate from the state, and never as an active trial', async () => {
    const { renderer } = await accessOf(entitlementOf({ status: 'expired', accessFrozenAtUtc: '2026-10-20T00:00:00Z' }));
    expect(texts(renderer)).toContain(i18n.t('subscription.trialInfo'));
    expect(texts(renderer)).not.toContain(i18n.t('subscription.access.trial'));
  });

  it('shows the compact information rows (account-wide, store billing, data kept)', async () => {
    const renderer = await renderScreen();
    expect(texts(renderer)).toEqual(expect.arrayContaining([
      i18n.t('subscription.infoHeading'), i18n.t('subscription.info.accountBody'), i18n.t('subscription.info.storeBody'), i18n.t('subscription.info.dataBody'),
    ]));
  });

  it('Restore is available in every state', async () => {
    for (const entitlement of [null, entitlementOf({}), entitlementOf({ status: 'active' }), entitlementOf({ status: 'expired' })]) {
      mockAuth(entitlement);
      expect(byId(await renderScreen(), 'subscription-restore')).toHaveLength(1);
    }
  });

  // ---- store ownership is separate from access ----
  const owned = (state: 'none' | 'active' | 'gracePeriod', extra: Record<string, unknown> = {}) => ({
    state, platform: state === 'none' ? null : 'google', productId: state === 'none' ? null : 'juple_monthly',
    currentPeriodEndsAtUtc: state === 'none' ? null : '2026-10-02T00:00:00Z', autoRenewing: state === 'none' ? null : true, ...extra,
  });
  const programOff = () => entitlementOf({ programEnabled: false, status: null, trialEndsAtUtc: null });
  const withOwnership = async (entitlement: unknown, storeSubscription: unknown) => {
    mockAuth(entitlement, storeSubscription);
    return renderScreen();
  };

  it('program off + no subscription: "not required yet", Subscribe offered', async () => {
    const renderer = await withOwnership(programOff(), owned('none'));
    expect(accessNodes(renderer, 'subscription-access')[0].props.children).toBe(i18n.t('subscription.access.inactive'));
    expect(accessNodes(renderer, 'subscription-store-state')).toHaveLength(0);
    expect(byId(renderer, 'subscription-subscribe')).toHaveLength(1);
  });

  it('program off + active store subscription: still "not required yet" for access, yet subscribed - no Subscribe, Manage offered', async () => {
    const renderer = await withOwnership(programOff(), owned('active'));
    expect(accessNodes(renderer, 'subscription-access')[0].props.children).toBe(i18n.t('subscription.access.inactive'));
    expect(accessNodes(renderer, 'subscription-store-state')[0].props.children).toBe(i18n.t('subscription.access.active'));
    expect(byId(renderer, 'subscription-subscribe')).toHaveLength(0);
    expect(byId(renderer, 'subscription-manage')).toHaveLength(1);
    expect(byId(renderer, 'subscription-restore')).toHaveLength(1);
    await press(renderer, 'subscription-manage');
    expect(store.openSubscriptionManagement).toHaveBeenCalledTimes(1);
    expect(store.purchase).not.toHaveBeenCalled();
  });

  it('program off + grace period: subscribed with the payment hint, no Subscribe', async () => {
    const renderer = await withOwnership(programOff(), owned('gracePeriod'));
    expect(accessNodes(renderer, 'subscription-store-state')[0].props.children).toBe(i18n.t('subscription.access.gracePeriod'));
    expect(accessNodes(renderer, 'subscription-store-state-detail')[0].props.children).toBe(i18n.t('subscription.detail.grace'));
    expect(byId(renderer, 'subscription-subscribe')).toHaveLength(0);
    expect(byId(renderer, 'subscription-manage')).toHaveLength(1);
  });

  it('a cancelled-but-current subscription (autoRenewing false) is still owned', async () => {
    const renderer = await withOwnership(programOff(), owned('active', { autoRenewing: false }));
    expect(byId(renderer, 'subscription-subscribe')).toHaveLength(0);
    expect(byId(renderer, 'subscription-manage')).toHaveLength(1);
  });

  it('program on + expired access + no ownership: Subscribe returns', async () => {
    const renderer = await withOwnership(entitlementOf({ status: 'expired', accessFrozenAtUtc: '2026-10-20T00:00:00Z' }), owned('none'));
    expect(byId(renderer, 'subscription-subscribe')).toHaveLength(1);
    expect(byId(renderer, 'subscription-manage')).toHaveLength(0);
  });

  it('program on + active access: no duplicate ownership block, Manage offered', async () => {
    const renderer = await withOwnership(entitlementOf({ status: 'active' }), owned('active'));
    expect(accessNodes(renderer, 'subscription-store-state')).toHaveLength(0);
    expect(byId(renderer, 'subscription-subscribe')).toHaveLength(0);
    expect(byId(renderer, 'subscription-manage')).toHaveLength(1);
  });

  it('an older backend without storeSubscription behaves exactly as before', async () => {
    const renderer = await withOwnership(programOff(), null);
    expect(byId(renderer, 'subscription-subscribe')).toHaveLength(1);
  });

  it('ownership updating (purchase / restore refresh) flips the same mounted screen without a restart', async () => {
    mockAuth(programOff(), owned('none'));
    let renderer!: ReactTestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = ReactTestRenderer.create(<SubscriptionScreen />);
    });
    expect(byId(renderer, 'subscription-subscribe')).toHaveLength(1);

    mockAuth(programOff(), owned('active'));
    await act(async () => {
      renderer.update(<SubscriptionScreen />);
    });
    expect(byId(renderer, 'subscription-subscribe')).toHaveLength(0);
    expect(byId(renderer, 'subscription-manage')).toHaveLength(1);
  });

  it('never mentions a store free trial - the trial is Juple-owned', async () => {
    const text = texts(await renderScreen()).join('|').toLowerCase();
    expect(text).not.toMatch(/free trial|무료 체험/);
  });
});

