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

function mockAuth(entitlement: unknown = null) {
  jest.mocked(useAuth).mockReturnValue({ entitlement } as unknown as ReturnType<typeof useAuth>);
}

beforeAll(async () => {
  await i18n.changeLanguage('en');
});
beforeEach(() => {
  store = { loadOffer: jest.fn().mockResolvedValue(readyOffer), purchase: jest.fn(), restore: jest.fn() };
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

  it('shows the account access the Backend reports, and "not required yet" while the program is off', async () => {
    mockAuth({ programEnabled: true, status: 'trial' });
    expect(texts(await renderScreen())).toContain(i18n.t('subscription.access.trial'));

    mockAuth({ programEnabled: false, status: null });
    expect(texts(await renderScreen())).toContain(i18n.t('subscription.access.inactive'));
  });

  it('never mentions a store free trial - the trial is Juple-owned', async () => {
    const text = texts(await renderScreen()).join('|').toLowerCase();
    expect(text).not.toMatch(/free trial|무료 체험/);
  });
});

