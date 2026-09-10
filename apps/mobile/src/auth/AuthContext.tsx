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
import { authorizeWithEntra, EntraAuthError, isEntraSessionInvalidError } from './entraAuthClient';
import { decodeIdTokenClaims, extractEmailClaim } from './idTokenClaims';
import {
  clearSession,
  getCachedIdToken,
  getValidAccessToken,
  onSessionInvalidated,
  saveAuthorizedSession,
} from './session/authSessionManager';
import { validateBackendSession } from './authSessionApi';
import { bootstrapCurrentUser } from './userBootstrapApi';
import { getDeviceRegionalSettings } from '../device/regionalSettings';
import { unregisterCurrentPushDeviceBestEffort } from '../push/pushLogoutUnregister';
import { clearCategoryShortcutsOnLogoutBestEffort } from '../share/clearCategoryShortcutsOnLogout';
import type { AuthContextValue, AuthState, UserBootstrapStatus } from './types';

const INITIAL_STATE: AuthState = {
  isInitializing: true,
  isSigningIn: false,
  isAuthenticated: false,
  error: null,
  backendAuthStatus: 'notChecked',
  userBootstrapStatus: 'notStarted',
  sessionRestoreStep: 'sessionRestore',
};

const SIGNED_OUT_STATE: AuthState = {
  isInitializing: false,
  isSigningIn: false,
  isAuthenticated: false,
  error: null,
  backendAuthStatus: 'notChecked',
  userBootstrapStatus: 'notStarted',
  sessionRestoreStep: 'sessionRestore',
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

/**
 * True only for a genuine Entra rejection of the stored session (refresh token actually
 * invalid/expired, or the authorization server otherwise explicitly refused it) - anything else
 * getValidAccessToken() can throw while restoring a session (offline, DNS failure, timeout,
 * connection reset, or the Entra endpoint itself being briefly unreachable) is a transient
 * transport failure, not proof the session is bad. See entraAuthClient.ts's own
 * isEntraSessionInvalidError, which authSessionManager.ts already uses for the same distinction
 * before deciding whether to actually clear the stored session.
 */
function isGenuineSessionRejection(caughtError: unknown): boolean {
  return (
    caughtError instanceof EntraAuthError &&
    isEntraSessionInvalidError(caughtError.cause)
  );
}

/**
 * A missing/never-existing session (AuthSessionError('sessionUnavailable') - see
 * authSessionManager.ts) is not an EntraAuthError at all, so it is never classified as transient
 * here and correctly falls through to signing out - there is nothing to retry.
 */
function isTransientSessionRestoreError(caughtError: unknown): boolean {
  return caughtError instanceof EntraAuthError && !isGenuineSessionRejection(caughtError);
}

export function AuthProvider({ children }: PropsWithChildren) {
  const { t } = useTranslation();
  const [state, setState] = useState<AuthState>(INITIAL_STATE);

  const setSignedOut = useCallback(() => {
    setState(SIGNED_OUT_STATE);
  }, []);

  useEffect(() => onSessionInvalidated(setSignedOut), [setSignedOut]);

  const runBootstrap = useCallback(async (isMountedRef: { current: boolean }) => {
    try {
      const accessToken = await getValidAccessToken({
        // Reports the two real sub-phases of restoring a session (see authSessionManager.ts) so
        // the Startup Progress UI can show determinate progress - never a fake timer.
        onStep: step => {
          if (isMountedRef.current) {
            setState(previous => ({ ...previous, sessionRestoreStep: step }));
          }
        },
      });

      if (isMountedRef.current) {
        setState(previous => ({
          ...previous,
          isInitializing: false,
          isSigningIn: false,
          isAuthenticated: true,
          error: null,
          backendAuthStatus: 'checking',
          userBootstrapStatus: 'notStarted',
        }));
      }

      const backendAuthStatus = await validateBackendSession(accessToken);
      if (isMountedRef.current) {
        setState(previous =>
          previous.isAuthenticated ? { ...previous, backendAuthStatus } : previous,
        );
      }

      if (backendAuthStatus === 'valid') {
        if (isMountedRef.current) {
          setState(previous =>
            previous.isAuthenticated
              ? { ...previous, userBootstrapStatus: 'checking' }
              : previous,
          );
        }

        const userBootstrapStatus = await bootstrapUserAccount(accessToken);
        if (isMountedRef.current) {
          setState(previous =>
            previous.isAuthenticated ? { ...previous, userBootstrapStatus } : previous,
          );
        }
      }
    } catch (caughtError) {
      if (!isMountedRef.current) {
        return;
      }

      // A transient failure while restoring the session (offline, DNS, timeout, connection reset,
      // or the Entra endpoint being briefly unreachable) must not discard a still-valid session -
      // only a genuine rejection (or no session at all) does. The user can retry manually (see
      // retryBootstrap below / AuthenticatedPlaceholder's retry action) - this never retries on
      // its own, so a real, sustained outage still surfaces clearly rather than looping forever.
      if (isTransientSessionRestoreError(caughtError)) {
        setState(previous => ({
          ...previous,
          isInitializing: false,
          isSigningIn: false,
          isAuthenticated: true,
          error: null,
          backendAuthStatus: 'unavailable',
          userBootstrapStatus: 'notStarted',
        }));
      } else {
        setSignedOut();
      }
    }
  }, [setSignedOut]);

  useEffect(() => {
    const isMountedRef = { current: true };
    runBootstrap(isMountedRef);
    return () => {
      isMountedRef.current = false;
    };
  }, [runBootstrap]);

  const retryBootstrap = useCallback(() => {
    const isMountedRef = { current: true };
    return runBootstrap(isMountedRef);
  }, [runBootstrap]);

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

      setState(previous => ({
        ...previous,
        isInitializing: false,
        isSigningIn: false,
        isAuthenticated: true,
        error: null,
        backendAuthStatus: 'checking',
        userBootstrapStatus: 'notStarted',
      }));

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
      setState(previous => ({
        ...previous,
        isInitializing: false,
        isSigningIn: false,
        isAuthenticated: false,
        error: toSafeAuthErrorMessage(caughtError, t),
        backendAuthStatus: 'notChecked',
        userBootstrapStatus: 'notStarted',
      }));
    }
  }, [t]);

  const signOut = useCallback(async () => {
    await unregisterCurrentPushDeviceBestEffort();
    await clearCategoryShortcutsOnLogoutBestEffort();
    await clearSession();
    setSignedOut();
  }, [setSignedOut]);

  // Display-only - re-decoded from the always-fresh module-level cache rather than threaded through
  // AuthState/every setState call site above (a JWT decode is cheap, and this avoids every one of
  // this file's several setState calls needing to also remember to set an email field).
  const userEmail = useMemo(
    () => (state.isAuthenticated ? extractEmailClaim(decodeIdTokenClaims(getCachedIdToken() ?? '')) : null),
    [state.isAuthenticated],
  );

  const value = useMemo<AuthContextValue>(
    () => ({ ...state, signIn, signOut, getValidAccessToken, retryBootstrap, userEmail }),
    [state, signIn, signOut, retryBootstrap, userEmail],
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
