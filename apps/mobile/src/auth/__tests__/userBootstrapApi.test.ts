import { ApiError } from '../../api/ApiError';
import { requestApi } from '../../api/apiClient';
import { bootstrapCurrentUser, parseEntitlement } from '../userBootstrapApi';

jest.mock('../../api/apiClient', () => ({
  requestApi: jest.fn(),
}));

describe('bootstrapCurrentUser', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  it('POSTs to the bootstrap endpoint and returns ready + the backend-reported plan on 200', async () => {
    jest.mocked(requestApi).mockResolvedValue({ status: 200, body: { plan: 'Free' } });

    const result = await bootstrapCurrentUser('a-token', { preferredLocale: 'ko-KR', timeZoneId: 'Asia/Seoul' });

    expect(requestApi).toHaveBeenCalledWith({
      method: 'POST',
      path: '/api/v1/users/me/bootstrap',
      accessToken: 'a-token',
      body: { preferredLocale: 'ko-KR', timeZoneId: 'Asia/Seoul' },
    });
    expect(result).toEqual({ status: 'ready', plan: 'Free', entitlement: null, mobileVersionPolicy: null });
  });

  it('returns the Plus plan when the backend reports it', async () => {
    jest.mocked(requestApi).mockResolvedValue({ status: 200, body: { plan: 'Plus' } });

    const result = await bootstrapCurrentUser('a-token', { preferredLocale: 'ko-KR', timeZoneId: 'Asia/Seoul' });

    expect(result).toEqual({ status: 'ready', plan: 'Plus', entitlement: null, mobileVersionPolicy: null });
  });

  it('carries the app-version policy of the server from the same bootstrap response - no separate request - and reads it defensively', async () => {
    const policy = { android: { latestBuild: 12, minimumSupportedBuild: 9, storeUrl: null }, ios: { latestBuild: 0, minimumSupportedBuild: 0, storeUrl: null } };
    jest.mocked(requestApi).mockResolvedValue({ status: 200, body: { plan: 'Free', mobileVersionPolicy: policy } });

    const result = await bootstrapCurrentUser('a-token', { preferredLocale: 'ko-KR', timeZoneId: 'Asia/Seoul' });

    expect(requestApi).toHaveBeenCalledTimes(1);
    expect(result.mobileVersionPolicy).toEqual(policy);

    jest.mocked(requestApi).mockResolvedValue({ status: 200, body: { plan: 'Free', mobileVersionPolicy: { android: 'garbage' } } });
    expect((await bootstrapCurrentUser('a-token', { preferredLocale: 'ko-KR', timeZoneId: 'Asia/Seoul' })).mobileVersionPolicy).toBeNull();
  });

  it('maps a badRequest (invalid device settings) error to invalidDeviceSettings with no plan', async () => {
    jest.mocked(requestApi).mockRejectedValue(new ApiError('badRequest', 400));

    const result = await bootstrapCurrentUser('a-token', { preferredLocale: 'invalid', timeZoneId: 'Invalid/Zone' });

    expect(result).toEqual({ status: 'invalidDeviceSettings', plan: null, entitlement: null, mobileVersionPolicy: null });
  });

  it('maps any other failure to unavailable with no plan', async () => {
    jest.mocked(requestApi).mockRejectedValue(new ApiError('unavailable'));

    const result = await bootstrapCurrentUser('a-token', { preferredLocale: 'ko-KR', timeZoneId: 'Asia/Seoul' });

    expect(result).toEqual({ status: 'unavailable', plan: null, entitlement: null, mobileVersionPolicy: null });
  });
});

const settings = { preferredLocale: 'ko-KR', timeZoneId: 'Asia/Seoul' };
const verifiedAtUtc = '2026-12-05T00:00:00+00:00';

describe('bootstrapCurrentUser - entitlement', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  it('keeps the legacy plan AND parses the program-not-launched entitlement (no status, can write)', async () => {
    jest.mocked(requestApi).mockResolvedValue({
      status: 200,
      body: {
        plan: 'Free',
        timeZoneId: 'Asia/Seoul',
        entitlement: {
          programEnabled: false,
          status: null,
          reason: null,
          trialStartedAtUtc: null,
          trialEndsAtUtc: null,
          currentPeriodEndsAtUtc: null,
          accessFrozenAtUtc: null,
          canWrite: true,
          verifiedAtUtc,
        },
      },
    });

    const result = await bootstrapCurrentUser('a-token', settings);

    expect(result.plan).toBe('Free');
    expect(result.entitlement).toEqual({
      programEnabled: false,
      status: null,
      reason: null,
      trialStartedAtUtc: null,
      trialEndsAtUtc: null,
      currentPeriodEndsAtUtc: null,
      accessFrozenAtUtc: null,
      canWrite: true,
      verifiedAtUtc,
    });
  });

  it('parses a trial', async () => {
    jest.mocked(requestApi).mockResolvedValue({
      status: 200,
      body: {
        plan: 'Free',
        entitlement: {
          programEnabled: true,
          status: 'trial',
          reason: 'none',
          trialStartedAtUtc: '2026-12-01T00:00:00+00:00',
          trialEndsAtUtc: '2026-12-31T00:00:00+00:00',
          currentPeriodEndsAtUtc: null,
          accessFrozenAtUtc: null,
          canWrite: true,
          verifiedAtUtc,
        },
      },
    });

    const { entitlement } = await bootstrapCurrentUser('a-token', settings);

    expect(entitlement).toMatchObject({ programEnabled: true, status: 'trial', reason: 'none', canWrite: true, trialEndsAtUtc: '2026-12-31T00:00:00+00:00' });
    expect(entitlement?.accessFrozenAtUtc).toBeNull();
  });

  it('parses active and gracePeriod with their period end', async () => {
    for (const status of ['active', 'gracePeriod'] as const) {
      jest.mocked(requestApi).mockResolvedValue({
        status: 200,
        body: {
          plan: 'Free',
          entitlement: {
            programEnabled: true,
            status,
            reason: status === 'gracePeriod' ? 'billingIssue' : 'none',
            trialStartedAtUtc: null,
            trialEndsAtUtc: null,
            currentPeriodEndsAtUtc: '2027-01-15T00:00:00+00:00',
            accessFrozenAtUtc: null,
            canWrite: true,
            verifiedAtUtc,
          },
        },
      });

      const { entitlement } = await bootstrapCurrentUser('a-token', settings);

      expect(entitlement).toMatchObject({ status, canWrite: true, currentPeriodEndsAtUtc: '2027-01-15T00:00:00+00:00' });
    }
  });

  it('parses an expired entitlement: cannot write, with the freeze instant', async () => {
    jest.mocked(requestApi).mockResolvedValue({
      status: 200,
      body: {
        plan: 'Free',
        entitlement: {
          programEnabled: true,
          status: 'expired',
          reason: 'none',
          trialStartedAtUtc: '2026-12-01T00:00:00+00:00',
          trialEndsAtUtc: '2026-12-31T00:00:00+00:00',
          currentPeriodEndsAtUtc: null,
          accessFrozenAtUtc: '2026-12-31T00:00:00+00:00',
          canWrite: false,
          verifiedAtUtc,
        },
      },
    });

    const { entitlement } = await bootstrapCurrentUser('a-token', settings);

    expect(entitlement).toMatchObject({ status: 'expired', canWrite: false, accessFrozenAtUtc: '2026-12-31T00:00:00+00:00' });
  });

  it('an older backend with no entitlement field still bootstraps, entitlement null', async () => {
    jest.mocked(requestApi).mockResolvedValue({ status: 200, body: { plan: 'Free' } });

    const result = await bootstrapCurrentUser('a-token', settings);

    expect(result).toEqual({ status: 'ready', plan: 'Free', entitlement: null, mobileVersionPolicy: null });
  });
});

describe('parseEntitlement', () => {
  it('treats anything that is not the documented object as absent', () => {
    expect(parseEntitlement(undefined)).toBeNull();
    expect(parseEntitlement(null)).toBeNull();
    expect(parseEntitlement('trial')).toBeNull();
    expect(parseEntitlement({})).toBeNull();
    expect(parseEntitlement({ programEnabled: true })).toBeNull();
    expect(parseEntitlement({ programEnabled: 'yes', canWrite: true })).toBeNull();
  });

  it('never guesses: an unknown status/reason from a newer backend is null, other fields still read', () => {
    const parsed = parseEntitlement({ programEnabled: true, status: 'paused', reason: 'weird', canWrite: false, trialEndsAtUtc: 12, verifiedAtUtc });

    expect(parsed).toEqual({
      programEnabled: true,
      status: null,
      reason: null,
      trialStartedAtUtc: null,
      trialEndsAtUtc: null,
      currentPeriodEndsAtUtc: null,
      accessFrozenAtUtc: null,
      canWrite: false,
      verifiedAtUtc,
    });
  });

  it('reads nothing but the documented fields (no identity hash, ids or tokens are carried)', () => {
    const parsed = parseEntitlement({
      programEnabled: true,
      status: 'trial',
      reason: 'none',
      canWrite: true,
      identityHash: 'abc',
      purchaseToken: 'secret',
      originalTransactionId: '123',
    });

    expect(Object.keys(parsed ?? {}).sort()).toEqual([
      'accessFrozenAtUtc',
      'canWrite',
      'currentPeriodEndsAtUtc',
      'programEnabled',
      'reason',
      'status',
      'trialEndsAtUtc',
      'trialStartedAtUtc',
      'verifiedAtUtc',
    ]);
  });
});
