import ReactTestRenderer, { act } from 'react-test-renderer';
import { endConnection, fetchProducts, initConnection, purchaseErrorListener, purchaseUpdatedListener } from 'react-native-iap';
import { useGoogleBilling } from '../useGoogleBilling';
import type { GoogleBilling } from '../googleBilling';

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

const mockRequest = jest.fn();
jest.mock('../../api/useAuthenticatedApi', () => ({ useAuthenticatedApi: () => mockRequest }));

const mockRefreshEntitlement = jest.fn();
jest.mock('../../auth/AuthContext', () => ({ useAuth: () => ({ refreshEntitlement: mockRefreshEntitlement }) }));

jest.mock('react-native', () => ({ Platform: { OS: 'android' } }));

function Probe({ onBilling }: { onBilling: (billing: GoogleBilling) => void }) {
  onBilling(useGoogleBilling());
  return null;
}

describe('useGoogleBilling', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.mocked(initConnection).mockResolvedValue(true as never);
    jest.mocked(endConnection).mockResolvedValue(true as never);
    jest.mocked(fetchProducts).mockResolvedValue([] as never);
    jest.mocked(purchaseUpdatedListener).mockReturnValue({ remove: jest.fn() } as never);
    jest.mocked(purchaseErrorListener).mockReturnValue({ remove: jest.fn() } as never);
    mockRequest.mockResolvedValue({ status: 200, body: { enabled: true, productId: 'juple_monthly', basePlanId: 'monthly', obfuscatedAccountId: 'key' } });
  });

  it('talks to the Backend catalog through the authenticated client, and releases the store connection when the screen goes away', async () => {
    let billing!: GoogleBilling;
    let renderer!: ReactTestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = ReactTestRenderer.create(<Probe onBilling={value => { billing = value; }} />);
    });

    await act(async () => {
      await billing.loadOffer();
    });
    expect(mockRequest).toHaveBeenCalledWith({ method: 'GET', path: '/api/v1/billing/google/catalog' });
    expect(initConnection).toHaveBeenCalledTimes(1);

    await act(async () => {
      renderer.unmount();
    });
    expect(endConnection).toHaveBeenCalledTimes(1);
  });
});
