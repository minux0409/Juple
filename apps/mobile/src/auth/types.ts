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
  /** Email-like claim (email, then preferred_username, then upn) decoded from the current id token, or null if unauthenticated/not present. Display-only, never used for authorization. */
  readonly userEmail: string | null;
}
