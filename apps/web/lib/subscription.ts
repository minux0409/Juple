/**
 * The account's subscription as the server reports it in the bootstrap answer (POST /api/v1/users/me/bootstrap: `entitlement` and
 * `storeSubscription`) - a port of the mobile reading (apps/mobile/src/auth/userBootstrapApi.ts parse*, billing/subscriptionStatus.ts
 * describeSubscription). Read-only on the Web: buying happens in the Android app's Google Play flow; nothing here is decided by the
 * browser, and no date is ever computed - a date appears only when the server sent it.
 */

export type EntitlementStatus = 'trial' | 'active' | 'gracePeriod' | 'expired';
export type EntitlementReason = 'none' | 'cancelled' | 'billingIssue' | 'refunded' | 'paused';

export interface Entitlement {
  readonly programEnabled: boolean;
  readonly status: EntitlementStatus | null;
  readonly reason: EntitlementReason | null;
  readonly trialEndsAtUtc: string | null;
  readonly accessFrozenAtUtc: string | null;
  readonly canWrite: boolean;
}

export interface StoreSubscription {
  readonly state: 'none' | 'active' | 'gracePeriod';
  readonly platform: 'google' | null;
  readonly currentPeriodEndsAtUtc: string | null;
  readonly autoRenewing: boolean | null;
  readonly startedAtUtc: string | null;
  readonly endedState: 'expired' | 'revoked' | null;
  readonly endedAtUtc: string | null;
}

export type DataRetentionPhase = 'billingHold' | 'readOnly' | 'deletionDue';

export interface DataRetention {
  readonly phase: DataRetentionPhase;
  readonly basis: 'paidAccessEnded' | 'trialEnded' | null;
  readonly accessEndedAtUtc: string | null;
  readonly deletionScheduledAtUtc: string | null;
  readonly nextNoticeAtUtc: string | null;
  readonly readOnly: boolean;
}

const ENTITLEMENT_STATUSES: readonly EntitlementStatus[] = ['trial', 'active', 'gracePeriod', 'expired'];
const ENTITLEMENT_REASONS: readonly EntitlementReason[] = ['none', 'cancelled', 'billingIssue', 'refunded', 'paused'];
const timestampOrNull = (value: unknown): string | null => (typeof value === 'string' && value.length > 0 ? value : null);

/** Additive bootstrap state; an absent/malformed/newer phase is ignored instead of guessed. */
export function parseDataRetention(raw: unknown): DataRetention | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const value = raw as Record<string, unknown>;
  const phase = (['billingHold', 'readOnly', 'deletionDue'] as const).find(candidate => candidate === value.phase);
  if (!phase) return null;
  return {
    phase,
    basis: value.basis === 'paidAccessEnded' || value.basis === 'trialEnded' ? value.basis : null,
    accessEndedAtUtc: timestampOrNull(value.accessEndedAtUtc),
    deletionScheduledAtUtc: timestampOrNull(value.deletionScheduledAtUtc),
    nextNoticeAtUtc: timestampOrNull(value.nextNoticeAtUtc),
    readOnly: value.readOnly === true,
  };
}

export function parseDataExportEnabled(raw: unknown): boolean {
  return typeof raw === 'object' && raw !== null && (raw as Record<string, unknown>).enabled === true;
}

/** Absent or malformed = null; a status / reason this build does not know (a newer server) is null rather than guessed. */
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
    trialEndsAtUtc: timestampOrNull(value.trialEndsAtUtc),
    accessFrozenAtUtc: timestampOrNull(value.accessFrozenAtUtc),
    canWrite: value.canWrite,
  };
}

/** Absent or unreadable = null; a state this build does not know is never guessed into "subscribed". */
export function parseStoreSubscription(raw: unknown): StoreSubscription | null {
  if (typeof raw !== 'object' || raw === null) {
    return null;
  }
  const value = raw as Record<string, unknown>;
  const state = (['none', 'active', 'gracePeriod'] as const).find(candidate => candidate === value.state);
  if (!state) {
    return null;
  }
  return {
    state,
    platform: value.platform === 'google' ? 'google' : null,
    currentPeriodEndsAtUtc: timestampOrNull(value.currentPeriodEndsAtUtc),
    autoRenewing: typeof value.autoRenewing === 'boolean' ? value.autoRenewing : null,
    startedAtUtc: timestampOrNull(value.startedAtUtc),
    endedState: value.endedState === 'expired' || value.endedState === 'revoked' ? value.endedState : null,
    endedAtUtc: timestampOrNull(value.endedAtUtc),
  };
}

export type SubscriptionView =
  | { readonly kind: 'unknown' }
  | { readonly kind: 'none' }
  | { readonly kind: 'trial'; readonly endsAtUtc: string | null }
  | { readonly kind: 'active'; readonly startedAtUtc: string | null; readonly nextPaymentAtUtc: string | null }
  | { readonly kind: 'gracePeriod'; readonly startedAtUtc: string | null }
  | { readonly kind: 'canceled'; readonly startedAtUtc: string | null; readonly accessEndsAtUtc: string | null }
  | { readonly kind: 'expired'; readonly endedAtUtc: string | null }
  | { readonly kind: 'revoked'; readonly endedAtUtc: string | null };

/** The ONE thing said about the account's subscription - exactly the mobile describeSubscription. */
export function describeSubscription(storeSubscription: StoreSubscription | null, entitlement: Entitlement | null): SubscriptionView {
  if (storeSubscription?.state === 'active') {
    return storeSubscription.autoRenewing === false
      ? { kind: 'canceled', startedAtUtc: storeSubscription.startedAtUtc, accessEndsAtUtc: storeSubscription.currentPeriodEndsAtUtc }
      : {
          kind: 'active',
          startedAtUtc: storeSubscription.startedAtUtc,
          nextPaymentAtUtc: storeSubscription.autoRenewing === true ? storeSubscription.currentPeriodEndsAtUtc : null,
        };
  }
  if (storeSubscription?.state === 'gracePeriod') {
    return { kind: 'gracePeriod', startedAtUtc: storeSubscription.startedAtUtc };
  }
  if (!storeSubscription && !entitlement) {
    return { kind: 'unknown' };
  }
  if (entitlement?.programEnabled && entitlement.status === 'trial') {
    return { kind: 'trial', endsAtUtc: entitlement.trialEndsAtUtc };
  }
  if (storeSubscription?.endedState === 'revoked') {
    return { kind: 'revoked', endedAtUtc: storeSubscription.endedAtUtc };
  }
  if (storeSubscription?.endedState === 'expired') {
    return { kind: 'expired', endedAtUtc: storeSubscription.endedAtUtc };
  }
  if (!storeSubscription && entitlement?.programEnabled) {
    if (entitlement.status === 'active') {
      return { kind: 'active', startedAtUtc: null, nextPaymentAtUtc: null };
    }
    if (entitlement.status === 'gracePeriod') {
      return { kind: 'gracePeriod', startedAtUtc: null };
    }
    if (entitlement.status === 'expired' && entitlement.reason === 'refunded') {
      return { kind: 'revoked', endedAtUtc: entitlement.accessFrozenAtUtc };
    }
  }
  return { kind: 'none' };
}

/** Where a Google Play subscription is managed (mobile useSubscriptionStore PLAY_SUBSCRIPTIONS_URL) - a public Play page. */
export const PLAY_SUBSCRIPTIONS_URL = 'https://play.google.com/store/account/subscriptions';

/**
 * Whether the Web shows 구독 at all (the settings entry and its page): only while the server says the paid program is live
 * (bootstrap entitlement.programEnabled - the authoritative flag, the same one the mobile app reads). Before that there is nothing to
 * show or manage, and the Web never sells: no subscription or payment entry appears.
 */
export function isSubscriptionEntryShown(entitlement: Entitlement | null): boolean {
  return entitlement?.programEnabled === true;
}
