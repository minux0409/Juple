import type { GetValidAccessTokenOptions, SessionRestoreStep } from './session/authSessionManager';

export type { SessionRestoreStep };

export type BackendAuthStatus =
  | 'notChecked'
  | 'checking'
  | 'valid'
  | 'unauthorized'
  | 'forbidden'
  | 'unavailable';

export type UserBootstrapStatus =
  | 'notStarted'
  | 'checking'
  | 'ready'
  | 'invalidDeviceSettings'
  | 'unavailable';

/** The current user's entitlement tier, as returned by the bootstrap endpoint (see userBootstrapApi.ts) - matches backend UserPlan.ToString() exactly. */
export type UserPlan = 'Free' | 'Plus';

/** What the backend says the account may do (see Entitlement in backend/Juple.Domain/Billing) - presentation state only: the backend decides every write. */
export type EntitlementStatus = 'trial' | 'active' | 'gracePeriod' | 'expired';

/** Why the status is what it is - copy only, never access. */
export type EntitlementReason = 'none' | 'cancelled' | 'billingIssue' | 'refunded' | 'paused';

/**
 * The bootstrap `entitlement` object. While the subscription program is not launched (`programEnabled` false) `status` and
 * `reason` are null and `canWrite` is true - that is NOT "active": nothing is restricted and nothing should be shown.
 * Typed here for later (R39-D) use; no screen reads it yet, so today's behavior is unchanged.
 */
export interface Entitlement {
  readonly programEnabled: boolean;
  readonly status: EntitlementStatus | null;
  readonly reason: EntitlementReason | null;
  readonly trialStartedAtUtc: string | null;
  readonly trialEndsAtUtc: string | null;
  readonly currentPeriodEndsAtUtc: string | null;
  /** Set only while expired: the instant live access ended. */
  readonly accessFrozenAtUtc: string | null;
  readonly canWrite: boolean;
  /** When the server computed this - the base of any later offline-cache window (never device time). */
  readonly verifiedAtUtc: string | null;
}

export interface AuthState {
  readonly isInitializing: boolean;
  readonly isSigningIn: boolean;
  readonly isAuthenticated: boolean;
  readonly error: string | null;
  readonly backendAuthStatus: BackendAuthStatus;
  readonly userBootstrapStatus: UserBootstrapStatus;
  /** Only meaningful before backendAuthStatus leaves 'notChecked' - see bootstrapProgress.ts. */
  readonly sessionRestoreStep: SessionRestoreStep;
  /** Null until userBootstrapStatus reaches 'ready' at least once - never guessed/defaulted client-side. Legacy: mirrors the backend's retained UserPlan field only - no screen may branch on it (every active user gets the same features; see docs/product-overview.md). */
  readonly plan: UserPlan | null;
  /** Null until bootstrap reaches 'ready' at least once, or when the backend (an older one) sent none. Never guessed client-side; nothing branches on it yet. */
  readonly entitlement: Entitlement | null;
}

export type { GetValidAccessTokenOptions };

export interface AuthContextValue extends AuthState {
  signIn: () => Promise<void>;
  signOut: () => Promise<void>;
  getValidAccessToken: (
    options?: GetValidAccessTokenOptions,
  ) => Promise<string>;
  /** Re-runs the session-restore/backend-check bootstrap - see AuthenticatedPlaceholder's retry action. */
  retryBootstrap: () => Promise<void>;
  /** Refreshes just the plan/entitlement from the server (after a verified purchase / restore) - no startup states, best effort, never throws. */
  refreshEntitlement: () => Promise<void>;
  /** Email-like claim (email, then preferred_username, then upn) decoded from the current id token, or null if unauthenticated/not present. Display-only, never used for authorization. */
  readonly userEmail: string | null;
}
