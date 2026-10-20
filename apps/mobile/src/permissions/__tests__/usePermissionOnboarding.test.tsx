import ReactTestRenderer, { act } from 'react-test-renderer';
import { AppState } from 'react-native';
import { usePermissionOnboarding } from '../usePermissionOnboarding';
import { ensurePushPermissionOnce } from '../../push/pushPermissionFlow';
import { navigationRef } from '../../navigation/navigationRef';

jest.mock('../../push/pushPermissionFlow', () => ({ ensurePushPermissionOnce: jest.fn().mockResolvedValue(undefined) }));
jest.mock('../../navigation/navigationRef', () => ({ navigationRef: { isReady: jest.fn(() => true) } }));
jest.mock('../../api/useAuthenticatedApi', () => ({ useAuthenticatedApi: () => mockRequest }));
jest.mock('../../push/pushMutationQueue', () => ({ pushRegistrationEpoch: () => 0 }));
const mockRequest = jest.fn();
let result: ReturnType<typeof usePermissionOnboarding>;
function Host({ enabled = true }: { enabled?: boolean }) {
  result = usePermissionOnboarding(enabled);
  return null;
}
let renderer: ReactTestRenderer.ReactTestRenderer;
beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  Object.defineProperty(AppState, 'currentState', { configurable: true, value: 'active', writable: true });
  jest.mocked(navigationRef.isReady).mockReturnValue(true);
  jest.mocked(ensurePushPermissionOnce).mockResolvedValue(undefined);
});
afterEach(() => { act(() => renderer?.unmount()); jest.useRealTimers(); });
it('waits for login and Terms, then finishes without a separate page', async () => {
  await act(async () => { renderer = ReactTestRenderer.create(<Host enabled={false} />); });
  expect(ensurePushPermissionOnce).not.toHaveBeenCalled();
  await act(async () => { renderer.update(<Host />); });
  expect(result.status).toBe('done');
  expect(ensurePushPermissionOnce).toHaveBeenCalledTimes(1);
  await act(async () => { jest.advanceTimersByTime(2000); renderer.update(<Host />); });
  expect(ensurePushPermissionOnce).toHaveBeenCalledTimes(1);
});
it('waits for navigation and an active app', async () => {
  jest.mocked(navigationRef.isReady).mockReturnValue(false);
  AppState.currentState = 'background';
  await act(async () => { renderer = ReactTestRenderer.create(<Host />); });
  expect(ensurePushPermissionOnce).not.toHaveBeenCalled();
  jest.mocked(navigationRef.isReady).mockReturnValue(true);
  await act(async () => { jest.advanceTimersByTime(250); });
  expect(ensurePushPermissionOnce).not.toHaveBeenCalled();
  AppState.currentState = 'active';
  await act(async () => { jest.advanceTimersByTime(250); });
  expect(result.status).toBe('done');
});
it('ignores a permission result after logout; relogin starts a fresh guarded run', async () => {
  let finish!: () => void;
  jest.mocked(ensurePushPermissionOnce).mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
  await act(async () => { renderer = ReactTestRenderer.create(<Host />); });
  const current = jest.mocked(ensurePushPermissionOnce).mock.calls[0][1]!;
  await act(async () => { renderer.update(<Host enabled={false} />); finish(); });
  expect(current()).toBe(false);
  expect(result.status).toBe('loading');
  await act(async () => { renderer.update(<Host />); });
  expect(result.status).toBe('done');
});
it('system failure still allows Home', async () => {
  jest.mocked(ensurePushPermissionOnce).mockRejectedValueOnce(new Error('OS'));
  await act(async () => { renderer = ReactTestRenderer.create(<Host />); });
  expect(result.status).toBe('done');
});
it('does not complete Home while the OS prompt is backgrounded and resumes safely', async () => {
  let finish!: () => void;
  jest.mocked(ensurePushPermissionOnce).mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
  await act(async () => { renderer = ReactTestRenderer.create(<Host />); });
  AppState.currentState = 'background';
  await act(async () => { finish(); });
  expect(result.status).toBe('loading');
  AppState.currentState = 'active';
  await act(async () => { jest.advanceTimersByTime(250); });
  expect(result.status).toBe('done');
});
