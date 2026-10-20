import ReactTestRenderer, { act } from 'react-test-renderer';
import { Modal, Text } from 'react-native';
import i18n from '../../i18n';
import { SubscriptionScreen } from '../SubscriptionScreen';
import { useAuth, useOptionalAuth } from '../../auth/AuthContext';
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
jest.mock('../../auth/AuthContext', () => ({ useAuth: jest.fn(), useOptionalAuth: jest.fn() }));
jest.mock('@react-navigation/native', () => ({ useNavigation: () => ({ navigate: jest.fn() }) }));
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
  jest.mocked(useOptionalAuth).mockReturnValue(undefined);
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

    expect(texts(renderer)).toEqual(expect.arrayContaining([i18n.t('subscription.planName'), i18n.t('subscription.cadence')]));
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

  // ---- the ONE subscription status (no separate "access / usage status", no program wording) ----
  const NOW = '2026-10-01T00:00:00Z';
  const entitlementOf = (overrides: Record<string, unknown>) => ({
    programEnabled: true, status: 'trial', reason: null, trialStartedAtUtc: '2026-09-20T00:00:00Z', trialEndsAtUtc: '2026-10-20T00:00:00Z',
    currentPeriodEndsAtUtc: null, accessFrozenAtUtc: null, canWrite: true, verifiedAtUtc: NOW, ...overrides,
  });
  const programOff = () => entitlementOf({ programEnabled: false, status: null, trialStartedAtUtc: null, trialEndsAtUtc: null });
  const storeOf = (overrides: Record<string, unknown>) => ({
    state: 'none', platform: null, productId: null, currentPeriodEndsAtUtc: null, autoRenewing: null,
    startedAtUtc: null, endedState: null, endedAtUtc: null, ...overrides,
  });
  const activeStore = (overrides: Record<string, unknown> = {}) => storeOf({
    state: 'active', platform: 'google', productId: 'juple_monthly', autoRenewing: true,
    startedAtUtc: '2026-10-11T00:00:00Z', currentPeriodEndsAtUtc: '2026-11-11T00:00:00Z', ...overrides,
  });
  const fmt = (iso: string) => new Intl.DateTimeFormat('en', { dateStyle: 'medium' }).format(new Date(iso));
  const textNodes = (renderer: ReactTestRenderer.ReactTestRenderer, testID: string) =>
    renderer.root.findAll(node => node.props.testID === testID && node.type === Text);
  const statusOf = (renderer: ReactTestRenderer.ReactTestRenderer) => String(textNodes(renderer, 'subscription-status')[0].props.children);
  const rowValue = (renderer: ReactTestRenderer.ReactTestRenderer, id: string) => {
    const node = textNodes(renderer, `subscription-row-${id}-value`)[0];
    return node ? String(node.props.children) : null;
  };
  const rowIds = (renderer: ReactTestRenderer.ReactTestRenderer) =>
    renderer.root.findAll(node => typeof node.props.testID === 'string' && /^subscription-row-[A-Za-z]+$/.test(node.props.testID)).map(node => node.props.testID as string);
  const noteOf = (renderer: ReactTestRenderer.ReactTestRenderer) => {
    const node = textNodes(renderer, 'subscription-status-note')[0];
    return node ? String(node.props.children) : null;
  };
  const screenWith = async (entitlement: unknown, storeSubscription: unknown) => {
    mockAuth(entitlement, storeSubscription);
    return renderScreen();
  };

  it('no subscription, program off: just "not subscribed" - no usage-status wording, no rows, no free-period claim', async () => {
    const renderer = await screenWith(programOff(), storeOf({}));

    expect(statusOf(renderer)).toBe(i18n.t('subscription.status.none'));
    expect(rowIds(renderer)).toEqual([]);
    expect(noteOf(renderer)).toBeNull();
    const all = texts(renderer).join('|');
    expect(all).not.toContain(i18n.t('subscription.note.trial'));
    expect(all).not.toMatch(/30 days|not required|Your access|required yet/i);
    expect(byId(renderer, 'subscription-subscribe')).toHaveLength(1);
    expect(byId(renderer, 'subscription-manage')).toHaveLength(0);
  });

  it('there is exactly one status heading and one status card - the old "access" section is gone', async () => {
    const renderer = await screenWith(programOff(), storeOf({}));

    expect(texts(renderer).filter(text => text === i18n.t('subscription.stateHeading'))).toHaveLength(1);
    expect(renderer.root.findAll(node => node.props.testID === 'subscription-status-card' && typeof node.type === 'string')).toHaveLength(1);
    for (const gone of ['subscription-access', 'subscription-store-state-card', 'subscription-trial-info']) {
      expect(renderer.root.findAll(node => node.props.testID === gone)).toHaveLength(0);
    }
  });

  it('nothing reported yet is shown as unknown - not as free, subscribed or not subscribed', async () => {
    const renderer = await screenWith(null, null);

    expect(statusOf(renderer)).toBe(i18n.t('subscription.status.unknown'));
    expect(rowIds(renderer)).toEqual([]);
  });

  it('running Juple trial: "free access" with the real end date and the Juple-provided note, Subscribe still available', async () => {
    const renderer = await screenWith(entitlementOf({}), storeOf({}));

    expect(statusOf(renderer)).toBe(i18n.t('subscription.status.trial'));
    expect(rowValue(renderer, 'trialEndsOn')).toBe(fmt('2026-10-20T00:00:00Z'));
    expect(noteOf(renderer)).toBe(i18n.t('subscription.note.trial'));
    expect(byId(renderer, 'subscription-subscribe')).toHaveLength(1);
  });

  it('a trial that is over (never subscribed) is "not subscribed" - no free-period note', async () => {
    const renderer = await screenWith(entitlementOf({ status: 'expired', accessFrozenAtUtc: '2026-10-20T00:00:00Z', canWrite: false }), storeOf({}));

    expect(statusOf(renderer)).toBe(i18n.t('subscription.status.none'));
    expect(noteOf(renderer)).toBeNull();
    expect(texts(renderer)).not.toContain(i18n.t('subscription.note.trial'));
  });

  it('active + auto-renew: start date, NEXT payment date and the catalog price; no Subscribe, Manage offered', async () => {
    const renderer = await screenWith(programOff(), activeStore());

    expect(statusOf(renderer)).toBe(i18n.t('subscription.status.active'));
    expect(rowValue(renderer, 'startedOn')).toBe(fmt('2026-10-11T00:00:00Z'));
    expect(rowValue(renderer, 'nextPaymentOn')).toBe(fmt('2026-11-11T00:00:00Z'));
    expect(rowValue(renderer, 'nextPaymentAmount')).toBe('$0.99');
    expect(rowValue(renderer, 'accessEndsOn')).toBeNull();
    expect(byId(renderer, 'subscription-subscribe')).toHaveLength(0);
    expect(byId(renderer, 'subscription-manage')).toHaveLength(1);
    await press(renderer, 'subscription-manage');
    expect(store.openSubscriptionManagement).toHaveBeenCalledTimes(1);
    expect(store.purchase).not.toHaveBeenCalled();
  });

  it('the next payment amount is the store catalog price as returned - never a built-in one', async () => {
    store.loadOffer.mockResolvedValue({ kind: 'ready', offer: { localizedPrice: '₩1,300', currencyCode: 'KRW', billingPeriod: 'P1M' } });
    const renderer = await screenWith(programOff(), activeStore());

    expect(rowValue(renderer, 'nextPaymentAmount')).toBe('₩1,300');
    expect(texts(renderer).join('|')).not.toContain('$0.99');
  });

  it('with no catalog price there is no amount row (nothing is guessed)', async () => {
    store.loadOffer.mockResolvedValue({ kind: 'unavailable', reason: 'storeUnavailable' });
    const renderer = await screenWith(programOff(), activeStore());

    expect(rowValue(renderer, 'nextPaymentAmount')).toBeNull();
    expect(rowValue(renderer, 'nextPaymentOn')).toBe(fmt('2026-11-11T00:00:00Z'));
  });

  it('cancelled but still current: the period end is the ACCESS END date - never labelled as a next payment', async () => {
    const renderer = await screenWith(programOff(), activeStore({ autoRenewing: false }));

    expect(statusOf(renderer)).toBe(i18n.t('subscription.status.canceled'));
    expect(rowValue(renderer, 'accessEndsOn')).toBe(fmt('2026-11-11T00:00:00Z'));
    expect(rowValue(renderer, 'startedOn')).toBe(fmt('2026-10-11T00:00:00Z'));
    expect(rowValue(renderer, 'nextPaymentOn')).toBeNull();
    expect(rowValue(renderer, 'nextPaymentAmount')).toBeNull();
    expect(noteOf(renderer)).toBe(i18n.t('subscription.note.canceled'));
    expect(byId(renderer, 'subscription-subscribe')).toHaveLength(0);
    expect(byId(renderer, 'subscription-manage')).toHaveLength(1);
  });

  it('expired: "subscription expired" with the real end date, Subscribe + Restore, no Manage', async () => {
    const renderer = await screenWith(
      entitlementOf({ status: 'expired', accessFrozenAtUtc: '2026-10-20T00:00:00Z', canWrite: false }),
      storeOf({ endedState: 'expired', endedAtUtc: '2026-10-20T00:00:00Z', startedAtUtc: '2026-09-20T00:00:00Z' }),
    );

    expect(statusOf(renderer)).toBe(i18n.t('subscription.status.expired'));
    expect(rowValue(renderer, 'endedOn')).toBe(fmt('2026-10-20T00:00:00Z'));
    expect(byId(renderer, 'subscription-subscribe')).toHaveLength(1);
    expect(byId(renderer, 'subscription-restore')).toHaveLength(1);
    expect(byId(renderer, 'subscription-manage')).toHaveLength(0);
  });

  it('expired with the program off is the same plain "expired" - no usage wording, still able to subscribe again', async () => {
    const renderer = await screenWith(programOff(), storeOf({ endedState: 'expired', endedAtUtc: '2026-10-20T00:00:00Z' }));

    expect(statusOf(renderer)).toBe(i18n.t('subscription.status.expired'));
    expect(texts(renderer).join('|')).not.toMatch(/not required|required yet|Your access/i);
    expect(byId(renderer, 'subscription-subscribe')).toHaveLength(1);
  });

  it('revoked: "subscription ended" with its end date', async () => {
    const renderer = await screenWith(programOff(), storeOf({ endedState: 'revoked', endedAtUtc: '2026-10-05T00:00:00Z' }));

    expect(statusOf(renderer)).toBe(i18n.t('subscription.status.revoked'));
    expect(rowValue(renderer, 'endedOn')).toBe(fmt('2026-10-05T00:00:00Z'));
    expect(byId(renderer, 'subscription-subscribe')).toHaveLength(1);
  });

  it('grace period: still subscribed, asks to check the payment method, Manage offered, no Subscribe', async () => {
    const renderer = await screenWith(programOff(), storeOf({ state: 'gracePeriod', platform: 'google', startedAtUtc: '2026-10-11T00:00:00Z', currentPeriodEndsAtUtc: '2026-11-11T00:00:00Z' }));

    expect(statusOf(renderer)).toBe(i18n.t('subscription.status.gracePeriod'));
    expect(noteOf(renderer)).toBe(i18n.t('subscription.detail.grace'));
    expect(byId(renderer, 'subscription-manage')).toHaveLength(1);
    expect(byId(renderer, 'subscription-subscribe')).toHaveLength(0);
  });

  it('a date the Backend did not send is a missing row - none is invented', async () => {
    const renderer = await screenWith(programOff(), activeStore({ startedAtUtc: null, currentPeriodEndsAtUtc: null }));

    expect(statusOf(renderer)).toBe(i18n.t('subscription.status.active'));
    expect(rowIds(renderer)).toEqual([]);
  });

  it('an active subscription whose renewal is not stated shows no next payment row', async () => {
    const renderer = await screenWith(programOff(), activeStore({ autoRenewing: null }));

    expect(rowValue(renderer, 'nextPaymentOn')).toBeNull();
    expect(rowValue(renderer, 'nextPaymentAmount')).toBeNull();
    expect(rowValue(renderer, 'startedOn')).toBe(fmt('2026-10-11T00:00:00Z'));
  });

  it('an older Backend without storeSubscription falls back to the entitlement alone', async () => {
    const renderer = await screenWith(entitlementOf({ status: 'active' }), null);

    expect(statusOf(renderer)).toBe(i18n.t('subscription.status.active'));
    expect(rowIds(renderer)).toEqual([]);
    expect(byId(renderer, 'subscription-manage')).toHaveLength(1);
  });

  it('never more than one primary call to action: Subscribe and Manage are mutually exclusive', async () => {
    const cases: [unknown, unknown][] = [
      [programOff(), storeOf({})], [entitlementOf({}), storeOf({})], [programOff(), activeStore()], [programOff(), activeStore({ autoRenewing: false })],
      [programOff(), storeOf({ endedState: 'expired' })], [programOff(), storeOf({ state: 'gracePeriod' })],
    ];
    for (const [entitlement, storeSubscription] of cases) {
      const renderer = await screenWith(entitlement, storeSubscription);
      expect(byId(renderer, 'subscription-subscribe').length + byId(renderer, 'subscription-manage').length).toBe(1);
      expect(byId(renderer, 'subscription-restore')).toHaveLength(1);
    }
  });

  it('the manage action is absent when the store has no management page, and a failure to open it is a plain message', async () => {
    store.canManageSubscription = false;
    const absent = await screenWith(programOff(), activeStore());
    expect(byId(absent, 'subscription-manage')).toHaveLength(0);

    store.canManageSubscription = true;
    store.openSubscriptionManagement.mockRejectedValue(new Error('no store'));
    const renderer = await screenWith(programOff(), activeStore());
    await press(renderer, 'subscription-manage');
    expect(openDialogTexts(renderer)).toContain(i18n.t('subscription.manageFailed'));
  });

  it('the server wins: a verified purchase result does not change the shown status by itself', async () => {
    store.purchase.mockResolvedValue({ kind: 'verified', state: 'active' });
    const renderer = await screenWith(programOff(), storeOf({ endedState: 'expired', endedAtUtc: '2026-10-20T00:00:00Z' }));

    await press(renderer, 'subscription-subscribe');

    expect(statusOf(renderer)).toBe(i18n.t('subscription.status.expired'));
  });

  it('shows the compact information rows (account-wide, store billing, data kept)', async () => {
    const renderer = await renderScreen();
    expect(texts(renderer)).toEqual(expect.arrayContaining([
      i18n.t('subscription.infoHeading'), i18n.t('subscription.info.accountBody'), i18n.t('subscription.info.storeBody'), i18n.t('subscription.info.dataBody'),
    ]));
  });
});
