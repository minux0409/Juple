export interface AuthState {
  readonly isInitializing: boolean;
  readonly isSigningIn: boolean;
  readonly isAuthenticated: boolean;
  readonly error: string | null;
}

export interface AuthContextValue extends AuthState {
  signIn: () => Promise<void>;
}
