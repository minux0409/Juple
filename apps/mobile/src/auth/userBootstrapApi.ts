import { ApiError } from '../api/ApiError';
import { requestApi } from '../api/apiClient';
import type { DeviceRegionalSettings } from '../device/regionalSettings';
import type { Entitlement, EntitlementReason, EntitlementStatus, UserBootstrapStatus, UserPlan } from './types';

export interface UserBootstrapResult {
  readonly status: UserBootstrapStatus;
  readonly plan: UserPlan | null;
  /** Null when the response carried none (an older backend) or it was not understood - never a guessed default. */
  readonly entitlement: Entitlement | null;
}

interface BootstrapCurrentUserResponseBody {
  readonly plan: UserPlan;
  readonly entitlement?: unknown;
}

const ENTITLEMENT_STATUSES: readonly EntitlementStatus[] = ['trial', 'active', 'gracePeriod', 'expired'];
const ENTITLEMENT_REASONS: readonly EntitlementReason[] = ['none', 'cancelled', 'billingIssue', 'refunded', 'paused'];

const timestampOrNull = (value: unknown): string | null => (typeof value === 'string' && value.length > 0 ? value : null);

/**
 * Reads the bootstrap `entitlement` defensively: an absent or malformed object is null (the app then behaves as it always
 * has), and a status/reason this build does not know (a newer backend) becomes null rather than being guessed.
 */
export function parseEntitlement(raw: unknown): Entitlement | null {
  if (typeof raw !== 'object' || raw === null) {
    return null;
  }
  const value = raw as Record<string, unknown>;
  if (typeof value.programEnabled !== 'boolean' || typeof value.canWrite !== 'boolean') {
    return null;
  }
  return {
    programEnabled: value.programEnabled,
    status: ENTITLEMENT_STATUSES.find(status => status === value.status) ?? null,
    reason: ENTITLEMENT_REASONS.find(reason => reason === value.reason) ?? null,
    trialStartedAtUtc: timestampOrNull(value.trialStartedAtUtc),
    trialEndsAtUtc: timestampOrNull(value.trialEndsAtUtc),
    currentPeriodEndsAtUtc: timestampOrNull(value.currentPeriodEndsAtUtc),
    accessFrozenAtUtc: timestampOrNull(value.accessFrozenAtUtc),
    canWrite: value.canWrite,
    verifiedAtUtc: timestampOrNull(value.verifiedAtUtc),
  };
}

export async function bootstrapCurrentUser(
  accessToken: string,
  regionalSettings: DeviceRegionalSettings,
): Promise<UserBootstrapResult> {
  try {
    const response = await requestApi<BootstrapCurrentUserResponseBody>({
      method: 'POST',
      path: '/api/v1/users/me/bootstrap',
      accessToken,
      body: regionalSettings,
    });
    return { status: 'ready', plan: response.body?.plan ?? null, entitlement: parseEntitlement(response.body?.entitlement) };
  } catch (error) {
    if (error instanceof ApiError && error.kind === 'badRequest') {
      return { status: 'invalidDeviceSettings', plan: null, entitlement: null };
    }

    return { status: 'unavailable', plan: null, entitlement: null };
  }
}
