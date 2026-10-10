import { ApiError } from '../api/ApiError';
import { requestApi } from '../api/apiClient';
import { parseMobileVersionPolicy, type MobileVersionPolicy } from '../appUpdate/versionPolicy';
import type { DeviceRegionalSettings } from '../device/regionalSettings';
import type { Entitlement, EntitlementReason, EntitlementStatus, StoreSubscription, StoreSubscriptionState, UserBootstrapStatus, UserPlan } from './types';

export interface UserBootstrapResult {
  readonly status: UserBootstrapStatus;
  readonly plan: UserPlan | null;
  /** Null when the response carried none (an older backend) or it was not understood - never a guessed default. */
  readonly entitlement: Entitlement | null;
  /** Whether the account owns a verified store subscription (separate from `entitlement`). Null when absent / not understood. */
  readonly storeSubscription?: StoreSubscription | null;
  /** Null when the response carried none (an older backend) or it was not understood - never a guessed default. */
  readonly mobileVersionPolicy?: MobileVersionPolicy | null;
}

interface BootstrapCurrentUserResponseBody {
  readonly plan: UserPlan;
  readonly entitlement?: unknown;
  readonly storeSubscription?: unknown;
  readonly mobileVersionPolicy?: unknown;
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

const STORE_SUBSCRIPTION_STATES: readonly StoreSubscriptionState[] = ['none', 'active', 'gracePeriod'];

/**
 * Reads the bootstrap `storeSubscription` defensively: absent or unreadable is null (the screen then falls back to the entitlement alone,
 * exactly as before), and a state this build does not know is never guessed into "subscribed".
 */
export function parseStoreSubscription(raw: unknown): StoreSubscription | null {
  if (typeof raw !== 'object' || raw === null) {
    return null;
  }
  const value = raw as Record<string, unknown>;
  const state = STORE_SUBSCRIPTION_STATES.find(candidate => candidate === value.state);
  if (!state) {
    return null;
  }
  return {
    state,
    platform: value.platform === 'google' ? 'google' : null,
    productId: typeof value.productId === 'string' && value.productId.length > 0 ? value.productId : null,
    currentPeriodEndsAtUtc: timestampOrNull(value.currentPeriodEndsAtUtc),
    autoRenewing: typeof value.autoRenewing === 'boolean' ? value.autoRenewing : null,
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
    return {
      status: 'ready',
      plan: response.body?.plan ?? null,
      entitlement: parseEntitlement(response.body?.entitlement),
      storeSubscription: parseStoreSubscription(response.body?.storeSubscription),
      mobileVersionPolicy: parseMobileVersionPolicy(response.body?.mobileVersionPolicy),
    };
  } catch (error) {
    if (error instanceof ApiError && error.kind === 'badRequest') {
      return { status: 'invalidDeviceSettings', plan: null, entitlement: null, storeSubscription: null, mobileVersionPolicy: null };
    }

    return { status: 'unavailable', plan: null, entitlement: null, storeSubscription: null, mobileVersionPolicy: null };
  }
}
