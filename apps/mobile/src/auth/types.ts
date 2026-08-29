export type BackendAuthStatus =
  | 'notChecked'
  | 'checking'
  | 'valid'
  | 'unauthorized'
  | 'forbidden'
  | 'unavailable';

export interface AuthState {
  readonly isInitializing: boolean;
  readonly isSigningIn: boolean;
  readonly isAuthenticated: boolean;
  readonly error: string | null;
  readonly backendAuthStatus: BackendAuthStatus;
}

export interface AuthContextValue extends AuthState {
  signIn: () => Promise<void>;
  signOut: () => Promise<void>;
}
