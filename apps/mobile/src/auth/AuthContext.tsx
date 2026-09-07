import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type PropsWithChildren,
} from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { authorizeWithEntra } from './entraAuthClient';
import {
  clearSession,
  getValidAccessToken,
  onSessionInvalidated,
  saveAuthorizedSession,
} from './session/authSessionManager';
import { validateBackendSession } from './authSessionApi';
import { bootstrapCurrentUser } from './userBootstrapApi';
import { getDeviceRegionalSettings } from '../device/regionalSettings';
import { unregisterCurrentPushDeviceBestEffort } from '../push/pushLogoutUnregister';
import type { AuthContextValue, AuthState, UserBootstrapStatus } from './types';

const INITIAL_STATE: AuthState = {
  isInitializing: true,
  isSigningIn: false,
  isAuthenticated: false,
  error: null,
  backendAuthStatus: 'notChecked',
  userBootstrapStatus: 'notStarted',
};

const SIGNED_OUT_STATE: AuthState = {
  isInitializing: false,
  isSigningIn: false,
  isAuthenticated: false,
  error: null,
  backendAuthStatus: 'notChecked',
  userBootstrapStatus: 'notStarted',
};

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

/** Maps a caught authorization error to a message safe to show without exposing tokens. */
function toSafeAuthErrorMessage(caughtError: unknown, t: TFunction): string {
  const message =
    caughtError instanceof Error ? caughtError.message : undefined;

  if (message && /cancel/i.test(message)) {
    return t('auth.cancelled');
  }

  return t('auth.failed');
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

export function AuthProvider({ children }: PropsWithChildren) {
  const { t } = useTranslation();
  const [state, setState] = useState<AuthState>(INITIAL_STATE);

  const setSignedOut = useCallback(() => {
    setState(SIGNED_OUT_STATE);
  }, []);

  useEffect(() => onSessionInvalidated(setSignedOut), [setSignedOut]);

  useEffect(() => {
    let isMounted = true;

    (async () => {
      try {
        const accessToken = await getValidAccessToken();

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
          setSignedOut();
        }
      }
    })();

    return () => {
      isMounted = false;
    };
  }, [setSignedOut]);

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

      await saveAuthorizedSession({
        accessToken: result.accessToken,
        accessTokenExpirationDate: result.accessTokenExpirationDate,
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
        error: toSafeAuthErrorMessage(caughtError, t),
        backendAuthStatus: 'notChecked',
        userBootstrapStatus: 'notStarted',
      });
    }
  }, [t]);

  const signOut = useCallback(async () => {
    await unregisterCurrentPushDeviceBestEffort();
    await clearSession();
    setSignedOut();
  }, [setSignedOut]);

  const value = useMemo<AuthContextValue>(
    () => ({ ...state, signIn, signOut, getValidAccessToken }),
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
