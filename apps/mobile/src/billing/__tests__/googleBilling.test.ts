import {
  endConnection,
  fetchProducts,
  finishTransaction,
  getAvailablePurchases,
  initConnection,
  purchaseErrorListener,
  purchaseUpdatedListener,
  requestPurchase,
} from 'react-native-iap';
import { ApiError } from '../../api/ApiError';
import { createGoogleBilling, type GoogleBillingApi } from '../googleBilling';
import type { PlanKey } from '../subscriptionPricing';
import type { GoogleCatalog, VerifyResponse } from '../types';

jest.mock('react-native-iap', () => ({
  initConnection: jest.fn(),
  endConnection: jest.fn(),
  fetchProducts: jest.fn(),
  requestPurchase: jest.fn(),
  finishTransaction: jest.fn(),
  getAvailablePurchases: jest.fn(),
  purchaseUpdatedListener: jest.fn(),
  purchaseErrorListener: jest.fn(),
}));

const CATALOG: GoogleCatalog = { enabled: true, productId: 'juple_monthly', basePlanId: 'monthly', obfuscatedAccountId: 'opaque-account-key' };
const VERIFIED: VerifyResponse = { outcome: 'verified', state: 'active', acknowledged: true };

type Listener<T> = (value: T) => void;
let emitPurchase: Listener<unknown>;
let emitError: Listener<unknown>;
let removeUpdate: jest.Mock;
let removeError: jest.Mock;
let calls: string[];

const offer = (overrides: Record<string, unknown> = {}) => ({
  id: 'monthly',
  type: 'introductory',
  basePlanIdAndroid: 'monthly',
  offerTokenAndroid: 'token-monthly',
  displayPrice: 'fallback price',
  currency: 'USD',
  pricingPhasesAndroid: {
    pricingPhaseList: [{ formattedPrice: '₩1,500', priceCurrencyCode: 'KRW', billingPeriod: 'P1M', billingCycleCount: 0, priceAmountMicros: '1500000000', recurrenceMode: 1 }],
  },
  ...overrides,
});

const product = (offers: unknown[]) => ({ id: 'juple_monthly', platform: 'android', type: 'subs', subscriptionOffers: offers });

function makeApi(overrides: Partial<GoogleBillingApi> = {}): jest.Mocked<GoogleBillingApi> {
  return {
    getCatalog: jest.fn(async () => CATALOG),
    verify: jest.fn(async () => {
      calls.push('verify');
      return VERIFIED;
    }),
    restore: jest.fn(async () => 'restored' as const),
    ...overrides,
  } as jest.Mocked<GoogleBillingApi>;
}

function makeBilling(api: GoogleBillingApi, platform = 'android') {
  const refreshEntitlement = jest.fn(async () => {
    calls.push('refresh');
  });
  return { billing: createGoogleBilling({ api, refreshEntitlement, platform }), refreshEntitlement };
}

async function reviewPlan(billing: ReturnType<typeof createGoogleBilling>, plan: PlanKey = 'monthly') {
  const result = await billing.loadPlans();
  const reviewed = result.kind === 'ready' && result.offers.find(candidate => candidate.plan === plan);
  if (!reviewed) {
    throw new Error(`Missing reviewed plan: ${plan}`);
  }
  return reviewed;
}

const pricedOffer = (formattedPrice: string, priceAmountMicros: string, priceCurrencyCode = 'KRW', billingPeriod = 'P1M') =>
  offer({ pricingPhasesAndroid: { pricingPhaseList: [
    { formattedPrice, priceCurrencyCode, billingPeriod, priceAmountMicros, billingCycleCount: 0, recurrenceMode: 1 },
  ] } });

const purchasedUpdate = (token = 'purchase-token-1', state = 'purchased') => ({ productId: 'juple_monthly', purchaseToken: token, purchaseState: state, id: 'order-1' });
const flush = () => new Promise<void>(resolve => setImmediate(() => resolve()));

beforeEach(() => {
  jest.clearAllMocks();
  calls = [];
  removeUpdate = jest.fn();
  removeError = jest.fn();
  jest.mocked(initConnection).mockResolvedValue(true as never);
  jest.mocked(endConnection).mockResolvedValue(true as never);
  jest.mocked(fetchProducts).mockResolvedValue([product([offer()])] as never);
  jest.mocked(requestPurchase).mockResolvedValue(undefined as never);
  jest.mocked(finishTransaction).mockImplementation((async () => {
    calls.push('finish');
  }) as never);
  jest.mocked(getAvailablePurchases).mockResolvedValue([] as never);
  jest.mocked(purchaseUpdatedListener).mockImplementation(((listener: Listener<unknown>) => {
    emitPurchase = listener;
    return { remove: removeUpdate };
  }) as never);
  jest.mocked(purchaseErrorListener).mockImplementation(((listener: Listener<unknown>) => {
    emitError = listener;
    return { remove: removeError };
  }) as never);
});

describe('connection lifecycle and offer', () => {
  it('opens the store connection once, however often the offer is loaded, and releases it with its listeners on dispose', async () => {
    const { billing } = makeBilling(makeApi());

    await billing.loadOffer();
    await billing.loadOffer();

    expect(initConnection).toHaveBeenCalledTimes(1);
    expect(purchaseUpdatedListener).toHaveBeenCalledTimes(1);

    await billing.dispose();

    expect(removeUpdate).toHaveBeenCalledTimes(1);
    expect(removeError).toHaveBeenCalledTimes(1);
    expect(endConnection).toHaveBeenCalledTimes(1);
  });

  it('never touches the store while the Backend says Google billing is disabled (or serves a partial catalog)', async () => {
    for (const catalog of [{ ...CATALOG, enabled: false }, { ...CATALOG, productId: null }, { ...CATALOG, obfuscatedAccountId: null }]) {
      const { billing } = makeBilling(makeApi({ getCatalog: jest.fn(async () => catalog) }));

      expect(await billing.loadOffer()).toEqual({ kind: 'unavailable', reason: 'disabled' });
    }
    expect(initConnection).not.toHaveBeenCalled();
    expect(fetchProducts).not.toHaveBeenCalled();
  });

  it('is unavailable on a platform that is not Android, with no store call (the iOS flow is a later round)', async () => {
    const api = makeApi();
    const { billing } = makeBilling(api, 'ios');

    expect(await billing.loadOffer()).toEqual({ kind: 'unavailable', reason: 'unsupportedPlatform' });
    expect(await billing.purchase()).toEqual({ kind: 'unavailable', reason: 'unsupportedPlatform' });
    expect(await billing.restore()).toEqual({ kind: 'unavailable', reason: 'unsupportedPlatform' });
    expect(api.getCatalog).not.toHaveBeenCalled();
    expect(initConnection).not.toHaveBeenCalled();
  });

  it('fetches the configured product from the store and exposes the STORE-localized price - no number of its own', async () => {
    const { billing } = makeBilling(makeApi());

    const result = await billing.loadOffer();

    expect(fetchProducts).toHaveBeenCalledWith({ skus: ['juple_monthly'], type: 'subs' });
    expect(result).toEqual({
      kind: 'ready',
      offer: {
        productId: 'juple_monthly',
        basePlanId: 'monthly',
        plan: 'monthly',
        priceAmount: 1500,
        priceAmountMicros: 1500000000,
        offerToken: 'token-monthly',
        localizedPrice: '₩1,500',
        currencyCode: 'KRW',
        billingPeriod: 'P1M',
        obfuscatedAccountId: 'opaque-account-key',
      },
    });
  });

  it('picks the configured monthly base plan and its plain recurring offer - never another plan or a trial/intro offer', async () => {
    const yearly = offer({ id: 'yearly', basePlanIdAndroid: 'yearly', offerTokenAndroid: 'token-yearly' });
    const monthlyWithTrial = offer({
      id: 'trial',
      type: 'promotional',
      offerTokenAndroid: 'token-trial',
      pricingPhasesAndroid: {
        pricingPhaseList: [
          { formattedPrice: 'Free', priceCurrencyCode: 'USD', billingPeriod: 'P7D', billingCycleCount: 1, priceAmountMicros: '0', recurrenceMode: 2 },
          { formattedPrice: '$0.99', priceCurrencyCode: 'USD', billingPeriod: 'P1M', billingCycleCount: 0, priceAmountMicros: '990000', recurrenceMode: 1 },
        ],
      },
    });
    const singlePhasePromo = offer({ ...pricedOffer('₩1,300', '1300000000'), id: 'monthly', type: 'promotional', offerTokenAndroid: 'promo' });
    const plain = offer({ offerTokenAndroid: 'token-plain' });
    jest.mocked(fetchProducts).mockResolvedValue([product([yearly, monthlyWithTrial, singlePhasePromo, plain])] as never);
    const { billing } = makeBilling(makeApi());

    const result = await billing.loadOffer();

    expect(result.kind === 'ready' && result.offer.offerToken).toBe('token-plain');
  });

  it('rejects duplicate base-plan offers, missing prices, and fixed or non-recurring phases', async () => {
    const phase = offer().pricingPhasesAndroid.pricingPhaseList[0];
    const invalidOffers = [
      [offer(), offer({ offerTokenAndroid: 'ambiguous' })],
      [offer({ pricingPhasesAndroid: null })],
      [offer({ pricingPhasesAndroid: { pricingPhaseList: [{ ...phase, priceAmountMicros: 'invalid' }] } })],
      [offer({ pricingPhasesAndroid: { pricingPhaseList: [{ ...phase, recurrenceMode: 2 }] } })],
      [offer({ pricingPhasesAndroid: { pricingPhaseList: [{ ...phase, recurrenceMode: 3 }] } })],
    ];
    const { billing } = makeBilling(makeApi());
    for (const offers of invalidOffers) {
      jest.mocked(fetchProducts).mockResolvedValueOnce([product(offers)] as never);
      expect(await billing.loadPlans()).toEqual({ kind: 'unavailable', reason: 'offerNotFound' });
    }
  });

  it('a base plan that only has a store trial/intro offer is not offered at all - never a second free period', async () => {
    const trialOnly = offer({
      id: 'trial',
      offerTokenAndroid: 'token-trial',
      pricingPhasesAndroid: {
        pricingPhaseList: [
          { formattedPrice: 'Free', priceCurrencyCode: 'USD', billingPeriod: 'P7D', billingCycleCount: 1, priceAmountMicros: '0', recurrenceMode: 2 },
          { formattedPrice: '$0.99', priceCurrencyCode: 'USD', billingPeriod: 'P1M', billingCycleCount: 0, priceAmountMicros: '990000', recurrenceMode: 1 },
        ],
      },
    });
    jest.mocked(fetchProducts).mockResolvedValue([product([trialOnly])] as never);

    expect(await makeBilling(makeApi()).billing.loadOffer()).toEqual({ kind: 'unavailable', reason: 'offerNotFound' });
  });

  it('reports a missing product, a missing base-plan offer and a store failure without throwing', async () => {
    jest.mocked(fetchProducts).mockResolvedValueOnce([] as never);
    expect(await makeBilling(makeApi()).billing.loadOffer()).toEqual({ kind: 'unavailable', reason: 'productNotFound' });

    jest.mocked(fetchProducts).mockResolvedValueOnce([product([offer({ basePlanIdAndroid: 'yearly' })])] as never);
    expect(await makeBilling(makeApi()).billing.loadOffer()).toEqual({ kind: 'unavailable', reason: 'offerNotFound' });

    jest.mocked(initConnection).mockRejectedValueOnce(new Error('Play Store missing'));
    expect(await makeBilling(makeApi()).billing.loadOffer()).toEqual({ kind: 'unavailable', reason: 'storeUnavailable' });
  });

  it('a failed connection can be retried', async () => {
    jest.mocked(initConnection).mockRejectedValueOnce(new Error('transient'));
    const { billing } = makeBilling(makeApi());

    expect((await billing.loadOffer()).kind).toBe('unavailable');
    expect((await billing.loadOffer()).kind).toBe('ready');
    expect(initConnection).toHaveBeenCalledTimes(2);
  });
});

describe('purchase', () => {
  async function startPurchase(api: GoogleBillingApi = makeApi()) {
    const harness = makeBilling(api);
    const reviewed = await reviewPlan(harness.billing);
    const result = harness.billing.purchase('monthly', reviewed);
    await flush();
    return { ...harness, result };
  }

  it('passes the server-issued obfuscated account id and the chosen offer token to Google Play', async () => {
    const { result, billing } = await startPurchase();

    expect(requestPurchase).toHaveBeenCalledWith({
      type: 'subs',
      request: { google: { skus: ['juple_monthly'], subscriptionOffers: [{ sku: 'juple_monthly', offerToken: 'token-monthly' }], obfuscatedAccountId: 'opaque-account-key' } },
    });
    emitError({ code: 'user-cancelled', message: 'cancel' });
    await result;
    await billing.dispose();
  });

  it('sends the token to the Backend and grants NOTHING until it answers: verify, then finish, then refresh - in that order', async () => {
    let release!: (value: VerifyResponse) => void;
    const api = makeApi({
      verify: jest.fn(
        () =>
          new Promise<VerifyResponse>(resolve => {
            calls.push('verify');
            release = resolve;
          }),
      ),
    });
    const { result, refreshEntitlement } = await startPurchase(api);

    emitPurchase(purchasedUpdate('the-token'));
    await flush();

    expect(api.verify).toHaveBeenCalledWith('the-token');
    // The store callback alone changed nothing: no finish, no entitlement refresh.
    expect(finishTransaction).not.toHaveBeenCalled();
    expect(refreshEntitlement).not.toHaveBeenCalled();

    release(VERIFIED);

    expect(await result).toEqual({ kind: 'verified', state: 'active' });
    expect(calls).toEqual(['verify', 'finish', 'refresh']);
    expect(finishTransaction).toHaveBeenCalledWith({ purchase: expect.objectContaining({ purchaseToken: 'the-token' }), isConsumable: false });
  });

  it.each([
    [new ApiError('conflict', 409, 'purchaseBelongsToAnotherAccount'), 'belongsToAnotherAccount'],
    [new ApiError('badRequest', 400, 'purchaseNotAllowed'), 'rejected'],
    [new ApiError('unavailable', 503, 'storeUnavailable'), 'temporary'],
    [new ApiError('timeout'), 'temporary'],
    [new Error('network'), 'temporary'],
  ])('a Backend failure (%#) leaves the purchase UNFINISHED and grants nothing', async (failure, reason) => {
    const api = makeApi({ verify: jest.fn(async () => { throw failure; }) });
    const { result, refreshEntitlement } = await startPurchase(api);

    emitPurchase(purchasedUpdate());

    expect(await result).toEqual({ kind: 'verificationFailed', reason });
    expect(finishTransaction).not.toHaveBeenCalled();
    expect(refreshEntitlement).not.toHaveBeenCalled();
  });

  it('a failed local finish after SERVER success does not undo the verified purchase', async () => {
    jest.mocked(finishTransaction).mockRejectedValueOnce(new Error('already acknowledged'));
    const { result, refreshEntitlement } = await startPurchase();

    emitPurchase(purchasedUpdate());

    expect(await result).toEqual({ kind: 'verified', state: 'active' });
    expect(refreshEntitlement).toHaveBeenCalledTimes(1);
  });

  it('a pending purchase (store callback or error code) grants nothing, finishes nothing and calls no verify', async () => {
    const api = makeApi();
    const first = await startPurchase(api);
    emitPurchase(purchasedUpdate('t', 'pending'));
    expect(await first.result).toEqual({ kind: 'pending' });
    await first.billing.dispose();

    const second = await startPurchase(api);
    emitError({ code: 'deferred-payment', message: 'later' });
    expect(await second.result).toEqual({ kind: 'pending' });

    expect(api.verify).not.toHaveBeenCalled();
    expect(finishTransaction).not.toHaveBeenCalled();
  });

  it('a server answer of "pending" is pending too: not finished, no entitlement refresh', async () => {
    const api = makeApi({ verify: jest.fn(async () => ({ outcome: 'pending' as const, state: 'pending', acknowledged: false })) });
    const { result, refreshEntitlement } = await startPurchase(api);

    emitPurchase(purchasedUpdate());

    expect(await result).toEqual({ kind: 'pending' });
    expect(finishTransaction).not.toHaveBeenCalled();
    expect(refreshEntitlement).not.toHaveBeenCalled();
  });

  it('a verified purchase that grants no access refreshes the entitlement but is not finished', async () => {
    const api = makeApi({ verify: jest.fn(async () => ({ outcome: 'notEntitled' as const, state: 'expired', acknowledged: false })) });
    const { result, refreshEntitlement } = await startPurchase(api);

    emitPurchase(purchasedUpdate());

    expect(await result).toEqual({ kind: 'notEntitled' });
    expect(finishTransaction).not.toHaveBeenCalled();
    expect(refreshEntitlement).toHaveBeenCalledTimes(1);
  });

  it('user cancellation and "already owned" are their own results', async () => {
    const cancelled = await startPurchase();
    emitError({ code: 'user-cancelled', message: 'x' });
    expect(await cancelled.result).toEqual({ kind: 'cancelled' });
    await cancelled.billing.dispose();

    const owned = await startPurchase();
    emitError({ code: 'already-owned', message: 'x' });
    expect(await owned.result).toEqual({ kind: 'alreadyOwned' });
  });

  it('a store error while starting the flow resolves as an error result', async () => {
    jest.mocked(requestPurchase).mockRejectedValueOnce({ code: 'billing-unavailable', message: 'no billing' });
    const { billing } = makeBilling(makeApi());

    expect(await billing.purchase('monthly', await reviewPlan(billing))).toEqual({ kind: 'error', code: 'billing-unavailable' });
  });

  it('a duplicate purchase callback for the same token converges on ONE verification and one finish', async () => {
    let release!: (value: VerifyResponse) => void;
    const api = makeApi({ verify: jest.fn(() => new Promise<VerifyResponse>(resolve => { release = resolve; })) });
    const { result } = await startPurchase(api);

    emitPurchase(purchasedUpdate('same-token'));
    emitPurchase(purchasedUpdate('same-token'));
    await flush();
    release(VERIFIED);
    await result;
    await flush();

    expect(api.verify).toHaveBeenCalledTimes(1);
    expect(finishTransaction).toHaveBeenCalledTimes(1);
  });

  it('ignores a store item that is not the configured subscription', async () => {
    const api = makeApi();
    const { result, billing } = await startPurchase(api);

    emitPurchase({ productId: 'something_else', purchaseToken: 'x', purchaseState: 'purchased' });
    await flush();

    expect(api.verify).not.toHaveBeenCalled();
    emitError({ code: 'user-cancelled', message: 'x' });
    await result;
    await billing.dispose();
  });

  it('disposing while a purchase is open resolves it as cancelled, never hangs', async () => {
    const { result, billing } = await startPurchase();

    await billing.dispose();

    expect(await result).toEqual({ kind: 'cancelled' });
  });
});

describe('restore', () => {
  it('nothing on the device and nothing known to the server: nothing found, and no entitlement refresh', async () => {
    const api = makeApi({ restore: jest.fn(async () => 'nothingFound' as const) });
    const { billing, refreshEntitlement } = makeBilling(api);

    expect(await billing.restore()).toEqual({ kind: 'nothingFound' });
    expect(api.restore).toHaveBeenCalledWith([]);
    expect(refreshEntitlement).not.toHaveBeenCalled();
  });

  it('hands the device purchases of THIS product to the Backend to verify, then refreshes the entitlement', async () => {
    jest.mocked(getAvailablePurchases).mockResolvedValue([
      { productId: 'juple_monthly', purchaseToken: 'tok-1' },
      { productId: 'juple_monthly', purchaseToken: 'tok-1' },
      { productId: 'juple_monthly', purchaseToken: 'tok-2' },
      { productId: 'other', purchaseToken: 'tok-3' },
      { productId: 'juple_monthly', purchaseToken: null },
    ] as never);
    const api = makeApi();
    const { billing, refreshEntitlement } = makeBilling(api);

    expect(await billing.restore()).toEqual({ kind: 'restored' });
    expect(getAvailablePurchases).toHaveBeenCalledWith({ includeSuspendedAndroid: true });
    expect(api.restore).toHaveBeenCalledWith(['tok-1', 'tok-2']);
    expect(refreshEntitlement).toHaveBeenCalledTimes(1);
  });

  it('does NOT trust the device: a held purchase the Backend rejects is not restored and grants nothing', async () => {
    jest.mocked(getAvailablePurchases).mockResolvedValue([{ productId: 'juple_monthly', purchaseToken: 'tok-1' }] as never);
    const api = makeApi({ restore: jest.fn(async () => 'nothingFound' as const) });
    const { billing, refreshEntitlement } = makeBilling(api);

    expect(await billing.restore()).toEqual({ kind: 'nothingFound' });
    expect(refreshEntitlement).not.toHaveBeenCalled();
    expect(finishTransaction).not.toHaveBeenCalled();
  });

  it.each(['belongsToAnotherJupleAccount', 'temporaryFailure'] as const)('passes the Backend outcome %s through without refreshing', async outcome => {
    const api = makeApi({ restore: jest.fn(async () => outcome) });
    const { billing, refreshEntitlement } = makeBilling(api);

    expect(await billing.restore()).toEqual({ kind: outcome });
    expect(refreshEntitlement).not.toHaveBeenCalled();
  });

  it('a store or network failure is a temporary failure, never an exception', async () => {
    jest.mocked(getAvailablePurchases).mockRejectedValueOnce(new Error('store down'));
    expect(await makeBilling(makeApi()).billing.restore()).toEqual({ kind: 'temporaryFailure' });

    const offline = makeApi({ getCatalog: jest.fn(async () => { throw new Error('offline'); }) });
    expect(await makeBilling(offline).billing.restore()).toEqual({ kind: 'temporaryFailure' });
  });

  it('is unavailable while the Backend has Google billing disabled', async () => {
    const api = makeApi({ getCatalog: jest.fn(async () => ({ ...CATALOG, enabled: false })) });

    expect(await makeBilling(api).billing.restore()).toEqual({ kind: 'unavailable', reason: 'disabled' });
    expect(getAvailablePurchases).not.toHaveBeenCalled();
  });
});

describe('monthly and yearly base plans', () => {
  const TWO_PLANS: GoogleCatalog = { ...CATALOG, basePlanIds: ['monthly', 'yearly'] };
  const yearlyOffer = () =>
    offer({
      id: 'yearly',
      basePlanIdAndroid: 'yearly',
      offerTokenAndroid: 'token-yearly',
      pricingPhasesAndroid: {
        pricingPhaseList: [{ formattedPrice: '₩15,000', priceCurrencyCode: 'KRW', billingPeriod: 'P1Y', billingCycleCount: 0, priceAmountMicros: '15000000000', recurrenceMode: 1 }],
      },
    });

  it('prices both plans from the store, each with its own period and amount - no number of the app\'s own', async () => {
    (fetchProducts as jest.Mock).mockResolvedValue([product([offer(), yearlyOffer()])]);
    const { billing } = makeBilling(makeApi({ getCatalog: jest.fn(async () => TWO_PLANS) }));

    const result = await billing.loadPlans();

    expect(result.kind).toBe('ready');
    const offers = result.kind === 'ready' ? result.offers : [];
    expect(offers.map(candidate => [candidate.plan, candidate.localizedPrice, candidate.priceAmount, candidate.billingPeriod])).toEqual([
      ['monthly', '₩1,500', 1500, 'P1M'],
      ['yearly', '₩15,000', 15000, 'P1Y'],
    ]);
  });

  it('does not treat an unknown base plan as monthly merely because it has a monthly billing period', async () => {
    (fetchProducts as jest.Mock).mockResolvedValue([product([offer({ basePlanIdAndroid: 'plan-a' }), yearlyOffer()])]);
    const { billing } = makeBilling(makeApi({ getCatalog: jest.fn(async () => ({ ...CATALOG, basePlanId: 'plan-a', basePlanIds: ['plan-a', 'yearly'] })) }));

    const result = await billing.loadPlans();

    expect(result.kind === 'ready' && result.offers.map(candidate => candidate.plan)).toEqual(['yearly']);
  });

  it('buys the yearly plan with the yearly offer token, and the monthly one by default', async () => {
    (fetchProducts as jest.Mock).mockResolvedValue([product([offer(), yearlyOffer()])]);
    const { billing } = makeBilling(makeApi({ getCatalog: jest.fn(async () => TWO_PLANS) }));

    const yearly = billing.purchase('yearly', await reviewPlan(billing, 'yearly'));
    await flush();
    emitPurchase(purchasedUpdate());
    await yearly;
    expect(requestPurchase).toHaveBeenLastCalledWith({
      type: 'subs',
      request: { google: { skus: ['juple_monthly'], subscriptionOffers: [{ sku: 'juple_monthly', offerToken: 'token-yearly' }], obfuscatedAccountId: 'opaque-account-key' } },
    });

    const monthly = billing.purchase(undefined, await reviewPlan(billing));
    await flush();
    emitPurchase(purchasedUpdate('purchase-token-2'));
    await monthly;
    expect(requestPurchase).toHaveBeenLastCalledWith({
      type: 'subs',
      request: { google: { skus: ['juple_monthly'], subscriptionOffers: [{ sku: 'juple_monthly', offerToken: 'token-monthly' }], obfuscatedAccountId: 'opaque-account-key' } },
    });
  });

  it('does not start a purchase for a plan the store did not return', async () => {
    (fetchProducts as jest.Mock).mockResolvedValue([product([offer()])]);
    const { billing } = makeBilling(makeApi({ getCatalog: jest.fn(async () => TWO_PLANS) }));

    expect(await billing.purchase('yearly')).toEqual({ kind: 'unavailable', reason: 'offerNotFound' });
    expect(requestPurchase).not.toHaveBeenCalled();
  });

  it('blocks a stale monthly price, returns both refreshed prices, and buys only after a second request with the fresh quote', async () => {
    const yearly = { ...pricedOffer('₩27,000', '27000000000', 'KRW', 'P1Y'), id: 'yearly', basePlanIdAndroid: 'yearly', offerTokenAndroid: 'yearly-token' };
    const fresh = { ...pricedOffer('₩2,700', '2700000000'), offerTokenAndroid: 'fresh-token' };
    jest.mocked(fetchProducts)
      .mockResolvedValueOnce([product([pricedOffer('₩1,300', '1300000000'), yearly])] as never)
      .mockResolvedValue([product([fresh, yearly])] as never);
    const { billing } = makeBilling(makeApi({ getCatalog: jest.fn(async () => TWO_PLANS) }));

    const reviewed = await reviewPlan(billing);
    const changed = await billing.purchase('monthly', reviewed);

    expect(requestPurchase).not.toHaveBeenCalled();
    if (changed.kind !== 'priceChanged') {
      throw new Error('Expected a fresh quote');
    }
    expect(changed.offers.map(candidate => [candidate.basePlanId, candidate.localizedPrice])).toEqual([
      ['monthly', '₩2,700'], ['yearly', '₩27,000'],
    ]);
    jest.mocked(fetchProducts).mockResolvedValueOnce([product([{ ...fresh, offerTokenAndroid: 'latest-token' }, yearly])] as never);
    const purchase = billing.purchase('monthly', changed.offers[0]);
    await flush();
    expect(requestPurchase).toHaveBeenCalledTimes(1);
    expect(requestPurchase).toHaveBeenCalledWith(expect.objectContaining({
      request: { google: { skus: ['juple_monthly'], subscriptionOffers: [{ sku: 'juple_monthly', offerToken: 'latest-token' }], obfuscatedAccountId: 'opaque-account-key' } },
    }));
    emitError({ code: 'user-cancelled' });
    expect(await purchase).toEqual({ kind: 'cancelled' });
  });

  it('compares amounts and currency even if the formatted price is the same', async () => {
    const { billing } = makeBilling(makeApi());
    const original = pricedOffer('1,300', '1300000000');
    jest.mocked(fetchProducts).mockResolvedValueOnce([product([original])] as never);
    const reviewed = await reviewPlan(billing);
    jest.mocked(fetchProducts)
      .mockResolvedValueOnce([product([pricedOffer('1,300', '2700000000')])] as never)
      .mockResolvedValueOnce([product([pricedOffer('1,300', '1300000000', 'JPY')])] as never);

    expect((await billing.purchase('monthly', reviewed)).kind).toBe('priceChanged');
    expect((await billing.purchase('monthly', reviewed)).kind).toBe('priceChanged');
    expect(requestPurchase).not.toHaveBeenCalled();
  });

  it('blocks an incompatible period and requires reconfirmation for a changed compatible period', async () => {
    const original = { ...yearlyOffer(), ...pricedOffer('₩27,000', '27000000000', 'KRW', 'P1Y'), id: 'yearly', basePlanIdAndroid: 'yearly' };
    const withPeriod = (period: string) => ({ ...original, pricingPhasesAndroid: {
      pricingPhaseList: [{ ...original.pricingPhasesAndroid.pricingPhaseList[0], billingPeriod: period }],
    } });
    jest.mocked(fetchProducts)
      .mockResolvedValueOnce([product([original])] as never)
      .mockResolvedValueOnce([product([withPeriod('P1M')])] as never)
      .mockResolvedValueOnce([product([withPeriod('P12M')])] as never);
    const { billing } = makeBilling(makeApi({ getCatalog: jest.fn(async () => TWO_PLANS) }));
    const reviewed = await reviewPlan(billing, 'yearly');

    expect(await billing.purchase('yearly', reviewed)).toEqual({ kind: 'unavailable', reason: 'offerNotFound' });
    expect((await billing.purchase('yearly', reviewed)).kind).toBe('priceChanged');
    expect(requestPurchase).not.toHaveBeenCalled();
  });

  it('blocks a failed requery, retries safely, and ignores a duplicate tap during the requery', async () => {
    const { billing } = makeBilling(makeApi());
    const reviewed = await reviewPlan(billing);
    jest.mocked(fetchProducts).mockRejectedValueOnce(new Error('Play offline'));

    expect(await billing.purchase('monthly', reviewed)).toEqual({ kind: 'unavailable', reason: 'storeUnavailable' });
    expect(requestPurchase).not.toHaveBeenCalled();
    const pending = billing.purchase('monthly', reviewed);
    expect(await billing.purchase('monthly', reviewed)).toEqual({ kind: 'cancelled' });
    await flush();
    expect(requestPurchase).toHaveBeenCalledTimes(1);
    expect(fetchProducts).toHaveBeenCalledTimes(3);
    emitError({ code: 'user-cancelled' });
    await pending;
  });

  it('loadOffer (the older single-plan call) still answers with the monthly offer', async () => {
    (fetchProducts as jest.Mock).mockResolvedValue([product([yearlyOffer(), offer()])]);
    const { billing } = makeBilling(makeApi({ getCatalog: jest.fn(async () => TWO_PLANS) }));

    const result = await billing.loadOffer();

    expect(result.kind === 'ready' && result.offer.billingPeriod).toBe('P1M');
  });
});
