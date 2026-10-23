import ReactTestRenderer, { act } from 'react-test-renderer';
import { AppState } from 'react-native';
import { AttentionProvider } from '../AttentionProvider';
import { useMobileAttention } from '../attentionContext';
import { emitSocialPushEvent } from '../../push/pushEvents';
import type { MobileAttentionStore } from '../mobileAttention';

let mockAccount = 'A';
let mockReady = true;
const mockRequest = jest.fn(async ({ path }: { path: string }) => ({ body: path.includes('collection-invitations')
  ? { items: [{ invitationId: 1 }] }
  : path.includes('friends/requests') ? { items: [{ requestId: 1, direction: 'incoming' }] }
  : { items: [], nextCursor: null } }));
jest.mock('../../auth/AuthContext', () => ({ useAuth: () => ({ isAuthenticated: mockReady, isSigningIn: false, backendAuthStatus: 'valid', userBootstrapStatus: 'ready' }) }));
jest.mock('../../api/useAuthenticatedApi', () => ({ useAuthenticatedApi: () => mockRequest }));
jest.mock('../../auth/session/authSessionManager', () => ({ getCachedIdToken: () => 'fixture-only' }));
jest.mock('../../auth/idTokenClaims', () => ({ decodeIdTokenClaims: () => ({ tid: 'fixture', oid: mockAccount }) }));

let store: MobileAttentionStore;
function Probe() { store = useMobileAttention()!; return null; }

it('isolates account switches/logout; foreground uses cache and rapid Push bursts retain one trailing refresh', async () => {
  jest.useFakeTimers();
  const listener = jest.spyOn(AppState, 'addEventListener');
  let foreground!: (state: string) => void;
  const remove = jest.fn();
  listener.mockImplementation(((_type: string, callback: (state: string) => void) => { foreground = callback; return { remove }; }) as never);
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  try {
    await act(async () => { renderer = ReactTestRenderer.create(<AttentionProvider><Probe /></AttentionProvider>); });
    expect(mockRequest).toHaveBeenCalledTimes(3);
    expect(store.getSnapshot().counts).toMatchObject({ collections: 1, myPage: 1 });
    await act(async () => { foreground('active'); });
    expect(mockRequest).toHaveBeenCalledTimes(3);
    await act(async () => {
      emitSocialPushEvent({ type: 'friendRequest', collectionId: null });
      emitSocialPushEvent({ type: 'friendRequest', collectionId: null });
      emitSocialPushEvent({ type: 'friendRequest', collectionId: null });
    });
    expect(mockRequest).toHaveBeenCalledTimes(3);
    await act(async () => { jest.advanceTimersByTime(2000); });
    expect(mockRequest).toHaveBeenCalledTimes(4);
    const previous = store;
    mockAccount = 'B';
    await act(async () => { renderer.update(<AttentionProvider><Probe /></AttentionProvider>); });
    expect(store).not.toBe(previous);
    expect(previous.getSnapshot().counts.collections).toBe(0);
    expect(mockRequest).toHaveBeenCalledTimes(7);
    mockReady = false;
    await act(async () => { renderer.update(<AttentionProvider><Probe /></AttentionProvider>); });
    expect(store.getSnapshot().counts).toMatchObject({ collections: 0, myPage: 0 });
    await act(async () => { foreground('active'); emitSocialPushEvent({ type: 'friendRequest', collectionId: null }); jest.advanceTimersByTime(60_000); });
    expect(mockRequest).toHaveBeenCalledTimes(7);
    expect(remove).toHaveBeenCalled();
  } finally {
    await act(async () => { renderer?.unmount(); });
    listener.mockRestore();
    jest.useRealTimers();
    mockReady = true;
    mockAccount = 'A';
  }
});
