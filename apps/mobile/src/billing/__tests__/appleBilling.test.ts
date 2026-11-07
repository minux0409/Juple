import {
  endConnection,
  fetchProducts,
  finishTransaction,
  getAvailablePurchases,
  initConnection,
  purchaseErrorListener,
  purchaseUpdatedListener,
  requestPurchase,
  restorePurchases,
} from 'react-native-iap';
import { ApiError } from '../../api/ApiError';
import { createAppleBilling, type AppleBillingApi } from '../appleBilling';
import type { AppleCatalog, VerifyResponse } from '../types';

jest.mock('react-native-iap', () => ({
  initConnection: jest.fn(),
  endConnection: jest.fn(),
  fetchProducts: jest.fn(),
  requestPurchase: jest.fn(),
  finishTransaction: jest.fn(),
  getAvailablePurchases: jest.fn(),
  restorePurchases: jest.fn(),
  purchaseUpdatedListener: jest.fn(),
  purchaseErrorListener: jest.fn(),
}));

const MONTHLY = 'com.juple.app.membership.monthly';
const YEARLY = 'com.juple.app.membership.yearly';
const CATALOG: AppleCatalog = { enabled: true, productIds: [MONTHLY, YEARLY], appAccountToken: '3f1c0f4e-9d0e-4f0a-8a3e-0a6d9f1c2b11' };
const VERIFIED: VerifyResponse = { outcome: 'verified', state: 'active', acknowledged: true };

type Listener<T> = (value: T) => void;
let emitPurchase: Listener<unknown>;
let emitError: Listener<unknown>;
let removeUpdate: jest.Mock;
let removeError: jest.Mock;
let calls: string[];

const product = (id: string, unit: string, count: string, price: number, display: string, currency = 'USD') => ({
  id,
  platform: 'ios',
  type: 'subs',
  title: 'Juple',
  description: 'Juple membership',
  displayPrice: display,
  currency,
  price,
  subscriptionPeriodUnitIOS: unit,
  subscriptionPeriodNumberIOS: count,
});

const products = () => [product(MONTHLY, 'month', '1', 1.99, '$1.99'), product(YEARLY, 'year', '1', 19.9, '$19.90')];

function makeApi(overrides: Partial<AppleBillingApi> = {}): jest.Mocked<AppleBillingApi> {
  return {
    getCatalog: jest.fn(async () => CATALOG),
    verify: jest.fn(async () => {
      calls.push('verify');
      return VERIFIED;
    }),
    restore: jest.fn(async () => 'restored' as const),
    ...overrides,
  } as jest.Mocked<AppleBillingApi>;
}

function makeBilling(api: AppleBillingApi, platform = 'ios') {
  const refreshEntitlement = jest.fn(async () => {
    calls.push('refresh');
  });
  return { billing: createAppleBilling({ api, refreshEntitlement, platform }), refreshEntitlement };
}

const purchasedUpdate = (productId = MONTHLY, jws = 'signed.transaction.jws', state = 'purchased') => ({ productId, purchaseToken: jws, purchaseState: state, transactionId: `tx-${jws}`, id: 'tx' });
const flush = () => new Promise<void>(resolve => setImmediate(() => resolve()));

beforeEach(() => {
  jest.clearAllMocks();
  calls = [];
  removeUpdate = jest.fn();
  removeError = jest.fn();
  (initConnection as jest.Mock).mockResolvedValue(true);
  (endConnection as jest.Mock).mockResolvedValue(true);
  (fetchProducts as jest.Mock).mockResolvedValue(products());
  (restorePurchases as jest.Mock).mockResolvedValue(undefined);
  (getAvailablePurchases as jest.Mock).mockResolvedValue([]);
  (finishTransaction as jest.Mock).mockImplementation(async () => {
    calls.push('finish');
  });
  (purchaseUpdatedListener as jest.Mock).mockImplementation((listener: Listener<unknown>) => {
    emitPurchase = listener;
    return { remove: removeUpdate };
  });
  (purchaseErrorListener as jest.Mock).mockImplementation((listener: Listener<unknown>) => {
    emitError = listener;
    return { remove: removeError };
  });
  (requestPurchase as jest.Mock).mockResolvedValue(undefined);
});

describe('loadPlans', () => {
  it("shows the App Store's own monthly and yearly prices for this storefront - the string and the amount, both from StoreKit", async () => {
    const { billing } = makeBilling(makeApi());

    const result = await billing.loadPlans();

    expect(result).toEqual({
      kind: 'ready',
      plans: [
        { plan: 'monthly', productId: MONTHLY, localizedPrice: '$1.99', priceAmount: 1.99, currencyCode: 'USD', billingPeriod: 'P1M' },
        { plan: 'yearly', productId: YEARLY, localizedPrice: '$19.90', priceAmount: 19.9, currencyCode: 'USD', billingPeriod: 'P1Y' },
      ],
    });
    expect(fetchProducts).toHaveBeenCalledWith({ skus: [MONTHLY, YEARLY], type: 'subs' });
  });

  it('a Korean storefront gets the Korean price strings, not a US price translated', async () => {
    (fetchProducts as jest.Mock).mockResolvedValue([
      product(MONTHLY, 'month', '1', 2900, '₩2,900', 'KRW'),
      product(YEARLY, 'year', '1', 29000, '₩29,000', 'KRW'),
    ]);
    const { billing } = makeBilling(makeApi());

    const result = await billing.loadPlans();

    expect(result.kind === 'ready' && result.plans.map(plan => plan.localizedPrice)).toEqual(['₩2,900', '₩29,000']);
  });

  it('reads the plan from the period StoreKit reports: twelve months is yearly, a week or a quarter is no Juple plan', async () => {
    (fetchProducts as jest.Mock).mockResolvedValue([
      product(MONTHLY, 'week', '1', 0.5, '$0.50'),
      product(YEARLY, 'month', '12', 19.9, '$19.90'),
    ]);
    const { billing } = makeBilling(makeApi());

    const result = await billing.loadPlans();

    expect(result.kind === 'ready' && result.plans.map(plan => plan.plan)).toEqual(['yearly']);
  });

  it('with only one product available, offers only that one - never a price the store did not give', async () => {
    (fetchProducts as jest.Mock).mockResolvedValue([product(MONTHLY, 'month', '1', 1.99, '$1.99')]);
    const { billing } = makeBilling(makeApi());

    const result = await billing.loadPlans();

    expect(result.kind === 'ready' && result.plans.map(plan => plan.plan)).toEqual(['monthly']);
  });

  it('ignores a product the server did not allowlist', async () => {
    (fetchProducts as jest.Mock).mockResolvedValue([product('com.other.app.sub', 'month', '1', 9.99, '$9.99')]);
    const { billing } = makeBilling(makeApi());

    expect(await billing.loadPlans()).toEqual({ kind: 'unavailable', reason: 'productNotFound' });
  });

  it('is unavailable on Android, while the program catalog is disabled, and when the store or the server fails', async () => {
    expect(await makeBilling(makeApi(), 'android').billing.loadPlans()).toEqual({ kind: 'unavailable', reason: 'unsupportedPlatform' });
    expect(await makeBilling(makeApi({ getCatalog: jest.fn(async () => ({ enabled: false, productIds: [], appAccountToken: null })) })).billing.loadPlans()).toEqual({ kind: 'unavailable', reason: 'disabled' });
    expect(await makeBilling(makeApi({ getCatalog: jest.fn(async () => { throw new Error('offline'); }) })).billing.loadPlans()).toEqual({ kind: 'unavailable', reason: 'storeUnavailable' });
    (fetchProducts as jest.Mock).mockRejectedValue(new Error('storekit down'));
    expect(await makeBilling(makeApi()).billing.loadPlans()).toEqual({ kind: 'unavailable', reason: 'storeUnavailable' });
    expect(initConnection).toHaveBeenCalled();
  });
});

describe('purchase', () => {
  const start = async (plan: 'monthly' | 'yearly', api = makeApi()) => {
    const { billing, refreshEntitlement } = makeBilling(api);
    const pending = billing.purchase(plan);
    await flush();
    return { billing, refreshEntitlement, pending, api };
  };

  it('buys the chosen plan with the server-issued App Account Token (never the user id)', async () => {
    const { pending } = await start('yearly');
    emitPurchase(purchasedUpdate(YEARLY));
    await pending;

    expect(requestPurchase).toHaveBeenCalledWith({ type: 'subs', request: { apple: { sku: YEARLY, appAccountToken: CATALOG.appAccountToken } } });
  });

  it('verifies on the SERVER first, finishes the StoreKit transaction only after that, and refreshes the entitlement last', async () => {
    const { pending, api } = await start('monthly');
    emitPurchase(purchasedUpdate(MONTHLY, 'the.signed.jws'));

    expect(await pending).toEqual({ kind: 'verified', state: 'active' });
    expect(api.verify).toHaveBeenCalledWith('the.signed.jws');
    expect(calls).toEqual(['verify', 'finish', 'refresh']);
  });

  it('a server failure finishes NOTHING and grants nothing: the paid transaction stays recoverable', async () => {
    const api = makeApi({ verify: jest.fn(async () => { throw new ApiError('unavailable', 503, 'storeUnavailable'); }) });
    const { pending, refreshEntitlement } = await start('monthly', api);
    emitPurchase(purchasedUpdate());

    expect(await pending).toEqual({ kind: 'verificationFailed', reason: 'temporary' });
    expect(finishTransaction).not.toHaveBeenCalled();
    expect(refreshEntitlement).not.toHaveBeenCalled();
  });

  it('another account\'s transaction is reported as such and is never finished or granted', async () => {
    const api = makeApi({ verify: jest.fn(async () => { throw new ApiError('conflict', 409, 'purchaseBelongsToAnotherAccount'); }) });
    const { pending } = await start('monthly', api);
    emitPurchase(purchasedUpdate());

    expect(await pending).toEqual({ kind: 'verificationFailed', reason: 'belongsToAnotherAccount' });
    expect(finishTransaction).not.toHaveBeenCalled();
  });

  it('Ask to Buy / a pending payment grants nothing and finishes nothing', async () => {
    const { pending } = await start('monthly');
    emitPurchase(purchasedUpdate(MONTHLY, 'jws', 'pending'));

    expect(await pending).toEqual({ kind: 'pending' });
    expect(finishTransaction).not.toHaveBeenCalled();
  });

  it('a server answer of "pending" also grants nothing', async () => {
    const api = makeApi({ verify: jest.fn(async () => ({ outcome: 'pending' as const, state: 'pending', acknowledged: true })) });
    const { pending } = await start('monthly', api);
    emitPurchase(purchasedUpdate());

    expect(await pending).toEqual({ kind: 'pending' });
    expect(finishTransaction).not.toHaveBeenCalled();
  });

  it('a verified-but-not-entitled transaction is finished (StoreKit would redeliver it forever) but not reported as access', async () => {
    const api = makeApi({ verify: jest.fn(async () => ({ outcome: 'notEntitled' as const, state: 'expired', acknowledged: true })) });
    const { pending } = await start('monthly', api);
    emitPurchase(purchasedUpdate());

    expect(await pending).toEqual({ kind: 'notEntitled' });
    expect(finishTransaction).toHaveBeenCalledTimes(1);
  });

  it('a failed local finish never undoes a verified purchase', async () => {
    (finishTransaction as jest.Mock).mockRejectedValue(new Error('finish failed'));
    const { pending, refreshEntitlement } = await start('monthly');
    emitPurchase(purchasedUpdate());

    expect(await pending).toEqual({ kind: 'verified', state: 'active' });
    expect(refreshEntitlement).toHaveBeenCalled();
  });

  it('the person cancelling the sheet is "cancelled", not an error', async () => {
    const { pending } = await start('monthly');
    emitError({ code: 'user-cancelled' });

    expect(await pending).toEqual({ kind: 'cancelled' });
  });

  it('a store error from requestPurchase itself resolves the purchase instead of hanging', async () => {
    (requestPurchase as jest.Mock).mockRejectedValue({ code: 'network-error' });
    const { billing } = makeBilling(makeApi());

    expect(await billing.purchase('monthly')).toEqual({ kind: 'error', code: 'network-error' });
  });

  it('a duplicate StoreKit callback for the same transaction verifies once', async () => {
    const { pending, api } = await start('monthly');
    emitPurchase(purchasedUpdate());
    emitPurchase(purchasedUpdate());
    await pending;
    await flush();

    expect(api.verify).toHaveBeenCalledTimes(1);
  });

  it('a transaction for a product that is not a Juple membership is not verified', async () => {
    const { pending, api } = await start('monthly');
    emitPurchase(purchasedUpdate('com.other.product'));

    expect(await pending).toEqual({ kind: 'error', code: 'unexpected-product' });
    expect(api.verify).not.toHaveBeenCalled();
  });

  it('a transaction without its signed representation cannot be verified - and is not granted', async () => {
    const { pending, api } = await start('monthly');
    emitPurchase({ ...purchasedUpdate(), purchaseToken: undefined });

    expect(await pending).toEqual({ kind: 'error', code: 'missing-transaction' });
    expect(api.verify).not.toHaveBeenCalled();
  });

  it('refuses to start when the chosen plan is not offered by the store', async () => {
    (fetchProducts as jest.Mock).mockResolvedValue([product(MONTHLY, 'month', '1', 1.99, '$1.99')]);
    const { billing } = makeBilling(makeApi());

    expect(await billing.purchase('yearly')).toEqual({ kind: 'unavailable', reason: 'productNotFound' });
    expect(requestPurchase).not.toHaveBeenCalled();
  });

  it('on Android it never touches StoreKit', async () => {
    const { billing } = makeBilling(makeApi(), 'android');

    expect(await billing.purchase('monthly')).toEqual({ kind: 'unavailable', reason: 'unsupportedPlatform' });
    expect(initConnection).not.toHaveBeenCalled();
  });
});

describe('restore', () => {
  it('syncs with the App Store, then hands the transactions to the SERVER - the device list is only candidates', async () => {
    (getAvailablePurchases as jest.Mock).mockResolvedValue([
      { productId: MONTHLY, purchaseToken: 'jws-1' },
      { productId: YEARLY, purchaseToken: 'jws-2' },
      { productId: 'com.other.product', purchaseToken: 'jws-other' },
      { productId: MONTHLY, purchaseToken: 'jws-1' },
    ]);
    const api = makeApi();
    const { billing, refreshEntitlement } = makeBilling(api);

    const result = await billing.restore();

    expect(restorePurchases).toHaveBeenCalledTimes(1);
    expect(api.restore).toHaveBeenCalledWith(['jws-1', 'jws-2']);
    expect(result).toEqual({ kind: 'restored' });
    expect(refreshEntitlement).toHaveBeenCalledTimes(1);
  });

  it('with nothing on the device it still asks the server to refresh the account\'s own purchases', async () => {
    const api = makeApi({ restore: jest.fn(async () => 'nothingFound' as const) });
    const { billing, refreshEntitlement } = makeBilling(api);

    expect(await billing.restore()).toEqual({ kind: 'nothingFound' });
    expect(api.restore).toHaveBeenCalledWith([]);
    expect(refreshEntitlement).not.toHaveBeenCalled();
  });

  it('reports another account\'s transaction and a temporary failure without refreshing the entitlement', async () => {
    const other = makeBilling(makeApi({ restore: jest.fn(async () => 'belongsToAnotherJupleAccount' as const) }));
    expect(await other.billing.restore()).toEqual({ kind: 'belongsToAnotherJupleAccount' });
    expect(other.refreshEntitlement).not.toHaveBeenCalled();

    (restorePurchases as jest.Mock).mockRejectedValue(new Error('apple id sign-in cancelled'));
    expect(await makeBilling(makeApi()).billing.restore()).toEqual({ kind: 'temporaryFailure' });
  });

  it('is unavailable on Android and while the catalog is disabled', async () => {
    expect(await makeBilling(makeApi(), 'android').billing.restore()).toEqual({ kind: 'unavailable', reason: 'unsupportedPlatform' });
    const disabled = makeApi({ getCatalog: jest.fn(async () => ({ enabled: false, productIds: [], appAccountToken: null })) });
    expect(await makeBilling(disabled).billing.restore()).toEqual({ kind: 'unavailable', reason: 'disabled' });
  });
});

describe('dispose', () => {
  it('releases the listeners and the store connection, and settles a purchase still waiting as cancelled', async () => {
    const { billing } = makeBilling(makeApi());
    const pending = billing.purchase('monthly');
    await flush();

    await billing.dispose();

    expect(await pending).toEqual({ kind: 'cancelled' });
    expect(removeUpdate).toHaveBeenCalled();
    expect(removeError).toHaveBeenCalled();
    expect(endConnection).toHaveBeenCalled();
  });
});
