import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
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
import { validateBackendSession } from './authSessionApi';
import { bootstrapCurrentUser } from './userBootstrapApi';
import { getDeviceRegionalSettings } from '../device/regionalSettings';
import type {
  AuthContextValue,
  AuthState,
  GetValidAccessTokenOptions,
  UserBootstrapStatus,
} from './types';

const INITIAL_STATE: AuthState = {
  isInitializing: true,
  isSigningIn: false,
  isAuthenticated: false,
  error: null,
  backendAuthStatus: 'notChecked',
  userBootstrapStatus: 'notStarted',
};

const AuthContext = createContext<AuthContextValue | undefined>(undefined);
const ACCESS_TOKEN_REFRESH_SKEW_MS = 60_000;

/** Maps a caught authorization error to a message safe to show without exposing tokens. */
function toSafeAuthErrorMessage(caughtError: unknown): string {
  const message =
    caughtError instanceof Error ? caughtError.message : undefined;

  if (message && /cancel/i.test(message)) {
    return '로그인이 취소되었습니다.';
  }

  return '로그인에 실패했습니다. 잠시 후 다시 시도해 주세요.';
}

async function bootstrapUserAccount(
  accessToken: string,
): Promise<UserBootstrapStatus> {
  try {
    return await bootstrapCurrentUser(accessToken, getDeviceRegionalSettings());
  } catch {
    return 'invalidDeviceSettings';
  }
}

function isAccessTokenUsable(expirationDate: string | null): boolean {
  if (!expirationDate) {
    return false;
  }

  const expirationMs = Date.parse(expirationDate);
  return (
    Number.isFinite(expirationMs) &&
    expirationMs > Date.now() + ACCESS_TOKEN_REFRESH_SKEW_MS
  );
}

export function AuthProvider({ children }: PropsWithChildren) {
  const [state, setState] = useState<AuthState>(INITIAL_STATE);
  const accessTokenRef = useRef<string | null>(null);
  const accessTokenExpirationDateRef = useRef<string | null>(null);
  const refreshInFlightRef = useRef<Promise<string> | null>(null);

  const setAccessToken = (
    accessToken: string,
    accessTokenExpirationDate: string,
  ) => {
    accessTokenRef.current = accessToken;
    accessTokenExpirationDateRef.current = accessTokenExpirationDate;
  };

  const clearAccessToken = () => {
    accessTokenRef.current = null;
    accessTokenExpirationDateRef.current = null;
  };

  const refreshAccessToken = useCallback(async (): Promise<string> => {
    if (refreshInFlightRef.current) {
      return refreshInFlightRef.current;
    }

    const refreshPromise = (async () => {
      const session = await loadAuthSession();
      if (!session) {
        throw new Error('An Entra refresh token is required.');
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

        setAccessToken(result.accessToken, result.accessTokenExpirationDate);
        return result.accessToken;
      } catch (caughtError) {
        const cause =
          caughtError instanceof EntraAuthError
            ? caughtError.cause
            : caughtError;
        if (isEntraSessionInvalidError(cause)) {
          await clearAuthSession();
          clearAccessToken();
          setState({
            isInitializing: false,
            isSigningIn: false,
            isAuthenticated: false,
            error: null,
            backendAuthStatus: 'notChecked',
            userBootstrapStatus: 'notStarted',
          });
        }

        throw caughtError;
      }
    })();

    refreshInFlightRef.current = refreshPromise;
    try {
      return await refreshPromise;
    } finally {
      if (refreshInFlightRef.current === refreshPromise) {
        refreshInFlightRef.current = null;
      }
    }
  }, []);

  const getValidAccessToken = useCallback(
    async (options: GetValidAccessTokenOptions = {}): Promise<string> => {
      if (
        !options.forceRefresh &&
        accessTokenRef.current &&
        isAccessTokenUsable(accessTokenExpirationDateRef.current)
      ) {
        return accessTokenRef.current;
      }

      return refreshAccessToken();
    },
    [refreshAccessToken],
  );

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
        const accessToken = await refreshAccessToken();

        if (isMounted) {
          setState({
            isInitializing: false,
            isSigningIn: false,
            isAuthenticated: true,
            error: null,
            backendAuthStatus: 'checking',
            userBootstrapStatus: 'notStarted',
          });
        }

        const backendAuthStatus = await validateBackendSession(accessToken);
        if (isMounted) {
          setState(previous =>
            previous.isAuthenticated
              ? { ...previous, backendAuthStatus }
              : previous,
          );
        }

        if (backendAuthStatus === 'valid') {
          if (isMounted) {
            setState(previous =>
              previous.isAuthenticated
                ? { ...previous, userBootstrapStatus: 'checking' }
                : previous,
            );
          }

          const userBootstrapStatus = await bootstrapUserAccount(accessToken);
          if (isMounted) {
            setState(previous =>
              previous.isAuthenticated
                ? { ...previous, userBootstrapStatus }
                : previous,
            );
          }
        }
      } catch {
        // A transient network failure should not discard a still-valid session.
        if (isMounted) {
          setState({
            isInitializing: false,
            isSigningIn: false,
            isAuthenticated: false,
            error: null,
            backendAuthStatus: 'notChecked',
            userBootstrapStatus: 'notStarted',
          });
        }
      }
    })();

    return () => {
      isMounted = false;
    };
  }, [refreshAccessToken]);

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

      setAccessToken(result.accessToken, result.accessTokenExpirationDate);

      await saveAuthSession({
        refreshToken: result.refreshToken,
        idToken: result.idToken,
      });

      setState({
        isInitializing: false,
        isSigningIn: false,
        isAuthenticated: true,
        error: null,
        backendAuthStatus: 'checking',
        userBootstrapStatus: 'notStarted',
      });

      const backendAuthStatus = await validateBackendSession(
        result.accessToken,
      );
      setState(previous =>
        previous.isAuthenticated
          ? { ...previous, backendAuthStatus }
          : previous,
      );

      if (backendAuthStatus === 'valid') {
        setState(previous =>
          previous.isAuthenticated
            ? { ...previous, userBootstrapStatus: 'checking' }
            : previous,
        );
        const userBootstrapStatus = await bootstrapUserAccount(
          result.accessToken,
        );
        setState(previous =>
          previous.isAuthenticated
            ? { ...previous, userBootstrapStatus }
            : previous,
        );
      }
    } catch (caughtError) {
      setState({
        isInitializing: false,
        isSigningIn: false,
        isAuthenticated: false,
        error: toSafeAuthErrorMessage(caughtError),
        backendAuthStatus: 'notChecked',
        userBootstrapStatus: 'notStarted',
      });
    }
  }, []);

  const signOut = useCallback(async () => {
    await clearAuthSession().catch(() => undefined);
    clearAccessToken();
    setState({
      isInitializing: false,
      isSigningIn: false,
      isAuthenticated: false,
      error: null,
      backendAuthStatus: 'notChecked',
      userBootstrapStatus: 'notStarted',
    });
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({ ...state, signIn, signOut, getValidAccessToken }),
    [state, signIn, signOut, getValidAccessToken],
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
