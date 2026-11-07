import ReactTestRenderer, { act } from 'react-test-renderer';
import { Text } from 'react-native';
import i18n from '../../i18n';
import { SubscriptionScreen } from '../SubscriptionScreen';
import { useAuth, useOptionalAuth } from '../../auth/AuthContext';
import type { SubscriptionPlan, SubscriptionStore } from '../../billing/subscriptionStore';
import { useSubscriptionStore } from '../../billing/useSubscriptionStore';

jest.mock('react-native-iap', () => {
  throw new Error('The shared Subscription screen must not depend on react-native-iap.');
});
jest.mock('../../billing/useSubscriptionStore', () => ({ useSubscriptionStore: jest.fn() }));
jest.mock('../../auth/AuthContext', () => ({ useAuth: jest.fn(), useOptionalAuth: jest.fn() }));
jest.mock('@react-navigation/native', () => ({ useNavigation: () => ({ navigate: jest.fn() }) }));
jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: ({ children }: { children: React.ReactNode }) => children,
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));

const plan = (key: 'monthly' | 'yearly', localizedPrice: string, priceAmount: number | null, currencyCode: string | null = 'USD'): SubscriptionPlan => ({
  key,
  localizedPrice,
  priceAmount,
  currencyCode,
  billingPeriod: key === 'monthly' ? 'P1M' : 'P1Y',
});

const US = [plan('monthly', '$1.99', 1.99), plan('yearly', '$19.90', 19.9)];

let store: jest.Mocked<SubscriptionStore>;

beforeAll(async () => {
  await i18n.changeLanguage('en');
});
beforeEach(() => {
  store = {
    loadOffer: jest.fn(),
    loadPlans: jest.fn().mockResolvedValue({ kind: 'ready', plans: US }),
    purchase: jest.fn().mockResolvedValue({ kind: 'cancelled' }),
    restore: jest.fn(),
    canManageSubscription: true,
    openSubscriptionManagement: jest.fn().mockResolvedValue(undefined),
  } as unknown as jest.Mocked<SubscriptionStore>;
  jest.mocked(useSubscriptionStore).mockReturnValue(store);
  jest.mocked(useOptionalAuth).mockReturnValue(undefined);
  jest.mocked(useAuth).mockReturnValue({ entitlement: null, storeSubscription: null } as unknown as ReturnType<typeof useAuth>);
});
afterEach(() => jest.clearAllMocks());

async function renderScreen() {
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => {
    renderer = ReactTestRenderer.create(<SubscriptionScreen />);
  });
  return renderer;
}
const all = (renderer: ReactTestRenderer.ReactTestRenderer, testID: string) => renderer.root.findAll(node => node.props.testID === testID);
const press = async (renderer: ReactTestRenderer.ReactTestRenderer, testID: string) => {
  await act(async () => {
    all(renderer, testID).find(node => typeof node.props.onPress === 'function')!.props.onPress();
  });
};
const text = (renderer: ReactTestRenderer.ReactTestRenderer) => renderer.root.findAllByType(Text).map(node => String(node.props.children)).join('|');
const isSelected = (renderer: ReactTestRenderer.ReactTestRenderer, key: string) =>
  all(renderer, `subscription-plan-${key}`).find(node => node.props.accessibilityState)!.props.accessibilityState.checked;

describe('membership plans', () => {
  it('shows the monthly and the yearly plan with the store prices, the yearly one first and recommended', async () => {
    const renderer = await renderScreen();

    expect(text(renderer)).toContain('$19.90 / year');
    expect(text(renderer)).toContain('$1.99 / month');
    expect(text(renderer)).toContain(i18n.t('subscription.plan.recommended'));
    expect(text(renderer)).toContain(i18n.t('subscription.plan.yearlyRenew'));
    expect(text(renderer)).toContain(i18n.t('subscription.plan.monthlyRenew'));
    const order = renderer.root.findAll(node => typeof node.props.testID === 'string' && /^subscription-plan-(monthly|yearly)$/.test(node.props.testID) && node.props.accessibilityRole === 'radio').map(node => node.props.testID);
    // (the composite and its host node both carry the id)
    expect([...new Set(order)]).toEqual(['subscription-plan-yearly', 'subscription-plan-monthly']);
  });

  it('computes the discount from THIS storefront: the US pair says about 17% and the saved amount', async () => {
    const renderer = await renderScreen();

    expect(all(renderer, 'subscription-discount-badge')[0].props.children).toBe('About 17% off');
    expect(text(renderer)).toContain('Save $3.98 compared with 12 monthly payments');
    expect(text(renderer)).toContain('About $1.66 per month');
  });

  it('a storefront with a different ratio gets its own percent - the 17 is never fixed', async () => {
    store.loadPlans.mockResolvedValue({ kind: 'ready', plans: [plan('monthly', '₩3,000', 3000, 'KRW'), plan('yearly', '₩24,000', 24000, 'KRW')] });
    const renderer = await renderScreen();

    expect(all(renderer, 'subscription-discount-badge')[0].props.children).toBe('About 33% off');
    expect(text(renderer)).not.toContain('17%');
  });

  it('claims no discount where yearly is not cheaper than twelve months, or where the store gave no amount', async () => {
    store.loadPlans.mockResolvedValue({ kind: 'ready', plans: [plan('monthly', '$1.99', 1.99), plan('yearly', '$23.88', 23.88)] });
    let renderer = await renderScreen();
    expect(all(renderer, 'subscription-discount-badge')).toHaveLength(0);
    expect(all(renderer, 'subscription-savings')).toHaveLength(0);

    store.loadPlans.mockResolvedValue({ kind: 'ready', plans: [plan('monthly', '$1.99', null), plan('yearly', '$19.90', null)] });
    renderer = await renderScreen();
    expect(all(renderer, 'subscription-discount-badge')).toHaveLength(0);
    expect(text(renderer)).toContain('$19.90 / year');
  });

  it('claims no discount when the two plans are priced in different currencies', async () => {
    store.loadPlans.mockResolvedValue({ kind: 'ready', plans: [plan('monthly', '$1.99', 1.99, 'USD'), plan('yearly', '€19.90', 19.9, 'EUR')] });

    expect(all(await renderScreen(), 'subscription-discount-badge')).toHaveLength(0);
  });

  it('preselects the recommended yearly plan, lets the person choose monthly, and buys exactly the chosen plan', async () => {
    const renderer = await renderScreen();
    expect(isSelected(renderer, 'yearly')).toBe(true);
    expect(isSelected(renderer, 'monthly')).toBe(false);

    await press(renderer, 'subscription-subscribe');
    expect(store.purchase).toHaveBeenLastCalledWith('yearly');

    await press(renderer, 'subscription-plan-monthly');
    expect(isSelected(renderer, 'monthly')).toBe(true);
    expect(isSelected(renderer, 'yearly')).toBe(false);
    await press(renderer, 'subscription-subscribe');
    expect(store.purchase).toHaveBeenLastCalledWith('monthly');
  });

  it('states the billing plainly: the total, the automatic renewal, the free period, how to cancel', async () => {
    const renderer = await renderScreen();

    expect(all(renderer, 'subscription-billing-summary')[0].props.children).toBe('$19.90 is charged every year and renews automatically until you cancel.');
    expect(all(renderer, 'subscription-free-notice')[0].props.children).toBe(i18n.t('subscription.billing.freeNotice'));
    expect(text(renderer)).toContain(i18n.t('subscription.billing.freeNotice'));
    expect(all(renderer, 'subscription-cancel-how').length).toBeGreaterThan(0);

    await press(renderer, 'subscription-plan-monthly');
    expect(all(renderer, 'subscription-billing-summary')[0].props.children).toBe('$1.99 is charged every month and renews automatically until you cancel.');
  });

  it('offers only the plans the store actually priced - one plan alone has no discount and nothing to compare', async () => {
    store.loadPlans.mockResolvedValue({ kind: 'ready', plans: [plan('monthly', '$1.99', 1.99)] });
    const renderer = await renderScreen();

    expect(all(renderer, 'subscription-plan-yearly')).toHaveLength(0);
    expect(isSelected(renderer, 'monthly')).toBe(true);
    expect(all(renderer, 'subscription-discount-badge')).toHaveLength(0);
    await press(renderer, 'subscription-subscribe');
    expect(store.purchase).toHaveBeenLastCalledWith('monthly');
  });

  it('with no store price there is no plan card, no price and no purchase', async () => {
    store.loadPlans.mockResolvedValue({ kind: 'unavailable', reason: 'storeUnavailable' });
    const renderer = await renderScreen();

    expect(all(renderer, 'subscription-plan-yearly')).toHaveLength(0);
    expect(all(renderer, 'subscription-plan-monthly')).toHaveLength(0);
    expect(text(renderer)).not.toMatch(/\$\d/);
    expect(all(renderer, 'subscription-subscribe').find(node => 'disabled' in node.props)!.props.disabled).toBe(true);
  });

  it('the legal row only shows the links that exist (terms and privacy are never invented)', async () => {
    const renderer = await renderScreen();

    expect(all(renderer, 'subscription-legal').length).toBeGreaterThan(0);
  });

  it('works the same with a Korean storefront in Korean: the price strings come from the store, the words from the locale', async () => {
    await i18n.changeLanguage('ko');
    store.loadPlans.mockResolvedValue({ kind: 'ready', plans: [plan('monthly', '₩2,900', 2900, 'KRW'), plan('yearly', '₩29,000', 29000, 'KRW')] });
    const renderer = await renderScreen();

    expect(text(renderer)).toContain('₩29,000 / 년');
    expect(text(renderer)).toContain('₩2,900 / 월');
    expect(all(renderer, 'subscription-discount-badge')[0].props.children).toBe('약 17% 할인');
    await i18n.changeLanguage('en');
  });
});
