import type { GetValidAccessTokenOptions } from './session/authSessionManager';

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

export interface AuthState {
  readonly isInitializing: boolean;
  readonly isSigningIn: boolean;
  readonly isAuthenticated: boolean;
  readonly error: string | null;
  readonly backendAuthStatus: BackendAuthStatus;
  readonly userBootstrapStatus: UserBootstrapStatus;
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
}
