import { authorizeWithEntra } from '../entraAuthClient';
import { getCachedIdToken, saveAuthorizedSession } from '../session/authSessionManager';
import { isSameAccount, reauthenticateSameAccount } from '../reauthentication';

jest.mock('../entraAuthClient', () => ({
  authorizeWithEntra: jest.fn(),
  REAUTHENTICATION_PARAMETERS: { prompt: 'login', max_age: '0' },
}));
jest.mock('../session/authSessionManager', () => ({
  getCachedIdToken: jest.fn(),
  saveAuthorizedSession: jest.fn().mockResolvedValue(undefined),
}));

function base64Url(value: string): string {
  // Plain arithmetic base64url for ASCII fixtures - no Buffer/btoa typings in this tsconfig.
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  const codes = Array.from(value, char => char.charCodeAt(0));
  let output = '';
  for (let index = 0; index < codes.length; index += 3) {
    const available = Math.min(3, codes.length - index);
    const chunk = codes[index] * 65536 + (codes[index + 1] ?? 0) * 256 + (codes[index + 2] ?? 0);
    for (let position = 0; position <= available; position += 1) {
      output += alphabet[Math.floor(chunk / 64 ** (3 - position)) % 64];
    }
  }
  return output;
}

const idToken = (claims: object) => `${base64Url('{"alg":"none"}')}.${base64Url(JSON.stringify(claims))}.sig`;
const me = idToken({ tid: 'tenant-1', oid: 'object-1', sub: 'sub-1', iss: 'issuer' });
const meAgain = idToken({ tid: 'tenant-1', oid: 'object-1', sub: 'sub-1', iss: 'issuer', auth_time: 2 });
const someoneElse = idToken({ tid: 'tenant-1', oid: 'object-2', sub: 'sub-2', iss: 'issuer' });

const newSession = {
  accessToken: 'new-access',
  accessTokenExpirationDate: '2099-01-01T00:00:00Z',
  refreshToken: 'new-refresh',
};

afterEach(() => {
  jest.clearAllMocks();
});

describe('isSameAccount', () => {
  it('matches on tenant + object id, else on issuer + subject', () => {
    expect(isSameAccount(me, meAgain)).toBe(true);
    expect(isSameAccount(me, someoneElse)).toBe(false);
    expect(isSameAccount(idToken({ iss: 'issuer', sub: 's' }), idToken({ iss: 'issuer', sub: 's' }))).toBe(true);
  });

  it('fails closed when either token is missing or unreadable', () => {
    expect(isSameAccount(null, me)).toBe(false);
    expect(isSameAccount(me, undefined)).toBe(false);
    expect(isSameAccount('garbage', 'garbage')).toBe(false);
    expect(isSameAccount(idToken({}), idToken({}))).toBe(false);
  });
});

describe('reauthenticateSameAccount', () => {
  it('asks Entra for prompt=login / max_age=0 and replaces the session only for the same account', async () => {
    jest.mocked(getCachedIdToken).mockReturnValue(me);
    jest.mocked(authorizeWithEntra).mockResolvedValue({ ...newSession, idToken: meAgain } as never);

    await expect(reauthenticateSameAccount()).resolves.toBe('reauthenticated');

    expect(authorizeWithEntra).toHaveBeenCalledWith({ prompt: 'login', max_age: '0' });
    expect(saveAuthorizedSession).toHaveBeenCalledWith({ ...newSession, idToken: meAgain });
  });

  it('a different account never replaces the current session', async () => {
    jest.mocked(getCachedIdToken).mockReturnValue(me);
    jest.mocked(authorizeWithEntra).mockResolvedValue({ ...newSession, idToken: someoneElse } as never);

    await expect(reauthenticateSameAccount()).resolves.toBe('differentAccount');
    expect(saveAuthorizedSession).not.toHaveBeenCalled();
  });

  it('an unknown current account, or a result without tokens, is not saved either', async () => {
    jest.mocked(getCachedIdToken).mockReturnValue(null);
    jest.mocked(authorizeWithEntra).mockResolvedValue({ ...newSession, idToken: meAgain } as never);
    await expect(reauthenticateSameAccount()).resolves.toBe('differentAccount');

    jest.mocked(getCachedIdToken).mockReturnValue(me);
    jest.mocked(authorizeWithEntra).mockResolvedValue({ accessToken: 'a', idToken: meAgain } as never);
    await expect(reauthenticateSameAccount()).resolves.toBe('incomplete');

    expect(saveAuthorizedSession).not.toHaveBeenCalled();
  });

  it('a cancelled sign-in propagates and saves nothing', async () => {
    jest.mocked(getCachedIdToken).mockReturnValue(me);
    jest.mocked(authorizeWithEntra).mockRejectedValue(new Error('cancelled'));

    await expect(reauthenticateSameAccount()).rejects.toThrow('cancelled');
    expect(saveAuthorizedSession).not.toHaveBeenCalled();
  });
});
