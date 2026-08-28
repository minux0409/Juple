import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type PropsWithChildren,
} from 'react';
import {
  authorizeWithEntra,
  isEntraSessionInvalidError,
  refreshEntraSession,
  EntraAuthError,
} from './entraAuthClient';
import {
  clearAuthSession,
  loadAuthSession,
  saveAuthSession,
} from './session/authSessionStorage';
import type { AuthContextValue, AuthState } from './types';

const INITIAL_STATE: AuthState = {
  isInitializing: true,
  isSigningIn: false,
  isAuthenticated: false,
  error: null,
};

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

/** Maps a caught authorization error to a message safe to show without exposing tokens. */
function toSafeAuthErrorMessage(caughtError: unknown): string {
  const message =
    caughtError instanceof Error ? caughtError.message : undefined;

  if (message && /cancel/i.test(message)) {
    return '로그인이 취소되었습니다.';
  }

  return '로그인에 실패했습니다. 잠시 후 다시 시도해 주세요.';
}

export function AuthProvider({ children }: PropsWithChildren) {
  const [state, setState] = useState<AuthState>(INITIAL_STATE);

  useEffect(() => {
    let isMounted = true;

    (async () => {
      const session = await loadAuthSession();
      if (!session) {
        if (isMounted) {
          setState(previous => ({ ...previous, isInitializing: false }));
        }
        return;
      }

      try {
        const result = await refreshEntraSession(session.refreshToken);
        if (!result.accessToken) {
          throw new Error('Entra refresh completed without an access token.');
        }

        if (result.refreshToken) {
          await saveAuthSession({
            refreshToken: result.refreshToken,
            idToken: result.idToken ?? session.idToken,
          });
        }

        if (isMounted) {
          setState({
            isInitializing: false,
            isSigningIn: false,
            isAuthenticated: true,
            error: null,
          });
        }
      } catch (caughtError) {
        // A transient network failure should not discard a still-valid session.
        const cause =
          caughtError instanceof EntraAuthError
            ? caughtError.cause
            : caughtError;
        if (isEntraSessionInvalidError(cause)) {
          await clearAuthSession();
        }

        if (isMounted) {
          setState({
            isInitializing: false,
            isSigningIn: false,
            isAuthenticated: false,
            error: null,
          });
        }
      }
    })();

    return () => {
      isMounted = false;
    };
  }, []);

  const signIn = useCallback(async () => {
    setState(previous =>
      previous.isSigningIn
        ? previous
        : { ...previous, isSigningIn: true, error: null },
    );

    try {
      const result = await authorizeWithEntra();
      if (!result.accessToken) {
        throw new Error(
          'Entra authorization completed without an access token.',
        );
      }
      if (!result.refreshToken) {
        throw new Error(
          'Entra authorization did not include a refresh token required for session persistence.',
        );
      }

      await saveAuthSession({
        refreshToken: result.refreshToken,
        idToken: result.idToken,
      });

      setState({
        isInitializing: false,
        isSigningIn: false,
        isAuthenticated: true,
        error: null,
      });
    } catch (caughtError) {
      setState({
        isInitializing: false,
        isSigningIn: false,
        isAuthenticated: false,
        error: toSafeAuthErrorMessage(caughtError),
      });
    }
  }, []);

  const signOut = useCallback(async () => {
    await clearAuthSession().catch(() => undefined);
    setState({
      isInitializing: false,
      isSigningIn: false,
      isAuthenticated: false,
      error: null,
    });
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({ ...state, signIn, signOut }),
    [state, signIn, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider.');
  }
  return context;
}
