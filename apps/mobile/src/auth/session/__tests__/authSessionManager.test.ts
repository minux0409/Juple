import { refreshEntraSession } from '../../entraAuthClient';
import { clearAuthSession, loadAuthSession, saveAuthSession } from '../authSessionStorage';

jest.mock('../../entraAuthClient', () => ({
  refreshEntraSession: jest.fn(),
  isEntraSessionInvalidError: (error: { code?: string } | undefined) => error?.code === 'invalid_grant',
  EntraAuthError: class EntraAuthError extends Error {},
}));
jest.mock('../authSessionStorage', () => ({
  saveAuthSession: jest.fn().mockResolvedValue(undefined),
  loadAuthSession: jest.fn(),
  clearAuthSession: jest.fn().mockResolvedValue(undefined),
}));

type Manager = typeof import('../authSessionManager');
let manager: Manager;
beforeEach(() => {
  jest.clearAllMocks();
  // A fresh module per test: the manager keeps its tokens in module state.
  jest.isolateModules(() => {
    manager = require('../authSessionManager');
  });
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

const FUTURE = '2099-01-01T00:00:00Z';
const reauthenticatedSession = { accessToken: 'fresh-access', accessTokenExpirationDate: FUTURE, refreshToken: 'fresh-refresh', idToken: 'fresh-id' };

describe('authSessionManager - a refresh of the old session never undoes a newer sign-in', () => {
  it('the foreground forced refresh that finishes AFTER a re-authentication was saved keeps the re-authenticated tokens', async () => {
    jest.mocked(loadAuthSession).mockResolvedValue({ refreshToken: 'old-refresh', idToken: 'old-id' });
    const oldRefresh = deferred<Awaited<ReturnType<typeof refreshEntraSession>>>();
    jest.mocked(refreshEntraSession).mockReturnValue(oldRefresh.promise);

    // The sign-in sheet closed -> the app is active again -> the session check refreshes with the OLD refresh token...
    const foregroundCheck = manager.getValidAccessToken({ forceRefresh: true });
    await Promise.resolve();
    await Promise.resolve();
    // ...while the re-authentication result is saved.
    await manager.saveAuthorizedSession(reauthenticatedSession);
    // Then the old refresh completes, carrying the old sign-in's access token.
    oldRefresh.resolve({ accessToken: 'stale-access', accessTokenExpirationDate: FUTURE, refreshToken: 'old-chain-refresh', idToken: 'old-id' } as never);

    await expect(foregroundCheck).resolves.toBe('fresh-access');
    // What the lock-password request sends next: the re-authenticated token, with its new auth_time.
    await expect(manager.getValidAccessToken()).resolves.toBe('fresh-access');
    expect(manager.getCachedIdToken()).toBe('fresh-id');
    // The old chain's refresh token was never written over the new one.
    expect(jest.mocked(saveAuthSession).mock.calls.map(([session]) => session.refreshToken)).toEqual(['fresh-refresh']);
  });

  it('an old session failing to refresh after it was replaced does not sign the person out', async () => {
    jest.mocked(loadAuthSession).mockResolvedValue({ refreshToken: 'old-refresh', idToken: 'old-id' });
    const oldRefresh = deferred<Awaited<ReturnType<typeof refreshEntraSession>>>();
    jest.mocked(refreshEntraSession).mockReturnValue(oldRefresh.promise);
    const invalidated = jest.fn();
    manager.onSessionInvalidated(invalidated);

    const foregroundCheck = manager.getValidAccessToken({ forceRefresh: true });
    await Promise.resolve();
    await Promise.resolve();
    await manager.saveAuthorizedSession(reauthenticatedSession);
    oldRefresh.reject({ code: 'invalid_grant' });

    await expect(foregroundCheck).resolves.toBe('fresh-access');
    expect(invalidated).not.toHaveBeenCalled();
    expect(clearAuthSession).not.toHaveBeenCalled();
  });

  it('without a newer sign-in, a refresh still stores and returns its own tokens', async () => {
    jest.mocked(loadAuthSession).mockResolvedValue({ refreshToken: 'old-refresh', idToken: 'old-id' });
    jest.mocked(refreshEntraSession).mockResolvedValue({ accessToken: 'refreshed', accessTokenExpirationDate: FUTURE, refreshToken: 'rotated', idToken: 'new-id' } as never);

    await expect(manager.getValidAccessToken({ forceRefresh: true })).resolves.toBe('refreshed');
    expect(saveAuthSession).toHaveBeenCalledWith({ refreshToken: 'rotated', idToken: 'new-id' });
    await expect(manager.getValidAccessToken()).resolves.toBe('refreshed');
  });

  it('a revoked session that was NOT replaced is still cleared and reported', async () => {
    jest.mocked(loadAuthSession).mockResolvedValue({ refreshToken: 'old-refresh', idToken: 'old-id' });
    jest.mocked(refreshEntraSession).mockRejectedValue({ code: 'invalid_grant' });
    const invalidated = jest.fn();
    manager.onSessionInvalidated(invalidated);

    await expect(manager.getValidAccessToken({ forceRefresh: true })).rejects.toEqual({ code: 'invalid_grant' });
    expect(invalidated).toHaveBeenCalledTimes(1);
    expect(clearAuthSession).toHaveBeenCalled();
  });

  it('signing out during a refresh leaves nothing behind', async () => {
    jest.mocked(loadAuthSession).mockResolvedValue({ refreshToken: 'old-refresh', idToken: 'old-id' });
    const oldRefresh = deferred<Awaited<ReturnType<typeof refreshEntraSession>>>();
    jest.mocked(refreshEntraSession).mockReturnValue(oldRefresh.promise);

    const check = manager.getValidAccessToken({ forceRefresh: true });
    await Promise.resolve();
    await Promise.resolve();
    await manager.clearSession();
    oldRefresh.resolve({ accessToken: 'stale-access', accessTokenExpirationDate: FUTURE, refreshToken: 'old-chain-refresh' } as never);

    await expect(check).rejects.toThrow();
    expect(saveAuthSession).not.toHaveBeenCalled();
    expect(manager.getCachedIdToken()).toBeNull();
  });
});
