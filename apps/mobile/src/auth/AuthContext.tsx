import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type PropsWithChildren,
} from 'react';
import { AppState } from 'react-native';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import {
  authorizeWithEntra,
  EntraAuthError,
  isEntraSessionInvalidError,
  REAUTHENTICATION_PARAMETERS,
  SIGN_IN_PARAMETERS,
} from './entraAuthClient';
import { decodeIdTokenClaims, extractEmailClaim } from './idTokenClaims';
import {
  clearSession,
  getCachedIdToken,
  getValidAccessToken,
  onSessionInvalidated,
  saveAuthorizedSession,
} from './session/authSessionManager';
import {
  ACTIVE_CHECK_INTERVAL_MS,
  createSessionValidator,
  FOREGROUND_CHECK_INTERVAL_MS,
} from './session/sessionValidator';
import { validateBackendSession } from './authSessionApi';
import { bootstrapCurrentUser, type UserBootstrapResult } from './userBootstrapApi';
import { isUserCancelledSignIn } from './signInErrors';
import { getDeviceRegionalSettings } from '../device/regionalSettings';
import { unregisterCurrentPushDeviceBestEffort } from '../push/pushLogoutUnregister';
import { clearCollectionShortcutsOnLogoutBestEffort } from '../share/clearCollectionShortcutsOnLogout';
import { purgeLegacyCollectionLockSecrets } from '../collections/legacyCollectionLockSecrets';
import { ConfirmDialog } from '../components/ConfirmDialog';
import type { AuthContextValue, AuthState } from './types';
import { clearStableImageUris } from '../images/stableImageUri';
import { clearCollectionIconCache } from '../collections/collectionIconImageCache';
import { clearProfileImageCache } from '../profile/profileImageCache';

const INITIAL_STATE: AuthState = {
  isInitializing: true,
  isSigningIn: false,
  isAuthenticated: false,
  error: null,
  backendAuthStatus: 'notChecked',
  userBootstrapStatus: 'notStarted',
  sessionRestoreStep: 'sessionRestore',
  plan: null,
  entitlement: null,
  storeSubscription: null,
  mobileVersionPolicy: null,
  dataRetention: null,
  dataExportEnabled: false,
};

const SIGNED_OUT_STATE: AuthState = {
  isInitializing: false,
  isSigningIn: false,
  isAuthenticated: false,
  error: null,
  backendAuthStatus: 'notChecked',
  userBootstrapStatus: 'notStarted',
  sessionRestoreStep: 'sessionRestore',
  plan: null,
  entitlement: null,
  storeSubscription: null,
  mobileVersionPolicy: null,
  dataRetention: null,
  dataExportEnabled: false,
};

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

/** Maps a caught authorization error to a message safe to show without exposing tokens. A cancel shows none (null). */
function toSafeAuthErrorMessage(caughtError: unknown, t: TFunction): string | null {
  return isUserCancelledSignIn(caughtError) ? null : t('auth.failed');
}

async function bootstrapUserAccount(
  accessToken: string,
): Promise<UserBootstrapResult> {
  try {
    return await bootstrapCurrentUser(accessToken, getDeviceRegionalSettings());
  } catch {
    return { status: 'invalidDeviceSettings', plan: null, entitlement: null, storeSubscription: null, mobileVersionPolicy: null };
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
    // Every way out of a session (sign-out, an invalidated session, a rejected restore): the shortcuts carry Collection
    // names, so none may survive for whoever signs in next. Fire-and-forget; signOut also awaits it explicitly.
    clearCollectionShortcutsOnLogoutBestEffort().catch(() => undefined);
    // The kept signed photo URLs (Item photos, Collection icons, profile photos) belong to this session's account only.
    clearStableImageUris();
    clearCollectionIconCache();
    clearProfileImageCache();
    setState(SIGNED_OUT_STATE);
  }, []);

  // Entra rejected the stored sign-in (e.g. the password was reset elsewhere - the session manager has already dropped the tokens):
  // one "다시 로그인이 필요합니다" dialog, however many requests noticed it, with a single 로그인하기 that goes to the sign-in screen.
  const [reauthRequired, setReauthRequired] = useState(false);
  useEffect(() => onSessionInvalidated(() => setReauthRequired(true)), []);

  const confirmReauthentication = useCallback(async () => {
    // Local only: the stored session (already cleared by the manager - repeated here so nothing can outlive the dialog) and the
    // signed-in state. The Entra browser session is not ended first; the sign-in screen offers 로그인 / 회원가입 as usual.
    await clearSession().catch(() => undefined);
    setReauthRequired(false);
    setSignedOut();
  }, [setSignedOut]);

  // Collection lock passwords are never kept on the device; clears what an earlier build may have left.
  useEffect(() => {
    purgeLegacyCollectionLockSecrets();
  }, []);

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

        const bootstrapResult = await bootstrapUserAccount(accessToken);
        if (bootstrapResult.status === 'signInRequired') {
          // A restored session whose Juple account no longer exists (deleted here or on another device) and that is too old
          // to start a new one: never re-create the account silently - drop the stale session; signing in again is explicit.
          await clearSession();
          if (isMountedRef.current) {
            setSignedOut();
          }
          return;
        }
        if (isMountedRef.current) {
          setState(previous =>
            previous.isAuthenticated
              ? { ...previous, userBootstrapStatus: bootstrapResult.status, plan: bootstrapResult.plan, entitlement: bootstrapResult.entitlement, storeSubscription: bootstrapResult.storeSubscription ?? null, mobileVersionPolicy: bootstrapResult.mobileVersionPolicy, dataRetention: bootstrapResult.dataRetention ?? null, dataExportEnabled: bootstrapResult.dataExportEnabled ?? false }
              : previous,
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

  // While signed in: ask Entra again (a forced refresh) when the app returns to the foreground and every few minutes while it stays
  // there, so a revoked sign-in is noticed before the in-memory access token expires. See session/sessionValidator.ts.
  const [validator] = useState(() => createSessionValidator({ validate: () => getValidAccessToken({ forceRefresh: true }) }));
  const isSignedIn = state.isAuthenticated && !state.isInitializing;
  useEffect(() => {
    if (!isSignedIn) {
      return;
    }
    const subscription = AppState.addEventListener('change', next => {
      if (next === 'active') {
        validator.check(FOREGROUND_CHECK_INTERVAL_MS);
      }
    });
    const timer = setInterval(() => {
      if (AppState.currentState === 'active') {
        validator.check(ACTIVE_CHECK_INTERVAL_MS);
      }
    }, FOREGROUND_CHECK_INTERVAL_MS);
    return () => {
      subscription.remove();
      clearInterval(timer);
    };
  }, [isSignedIn, validator]);

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

  // Re-reads ONLY the account's plan/entitlement from the server's bootstrap response, with none of the startup states a full
  // bootstrap passes through - used after a verified purchase or restore. Best effort: the purchase is already recorded on the
  // server, and the next launch's bootstrap would show it anyway.
  const refreshEntitlement = useCallback(async () => {
    try {
      const accessToken = await getValidAccessToken();
      const result = await bootstrapCurrentUser(accessToken, getDeviceRegionalSettings());
      if (result.status === 'ready') {
        setState(previous =>
          previous.isAuthenticated ? { ...previous, plan: result.plan, entitlement: result.entitlement, storeSubscription: result.storeSubscription ?? previous.storeSubscription, mobileVersionPolicy: result.mobileVersionPolicy ?? previous.mobileVersionPolicy, dataRetention: result.dataRetention ?? null, dataExportEnabled: result.dataExportEnabled ?? previous.dataExportEnabled } : previous,
        );
      }
    } catch {
      // See above.
    }
  }, []);

  const signIn = useCallback(async () => {
    setState(previous =>
      previous.isSigningIn
        ? previous
        : { ...previous, isSigningIn: true, error: null },
    );

    try {
      const result = await authorizeWithEntra(SIGN_IN_PARAMETERS);
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
        let bootstrapResult = await bootstrapUserAccount(
          result.accessToken,
        );
        if (bootstrapResult.status === 'signInRequired') {
          // The browser's single sign-on session answered without asking for credentials, and this identity has no Juple
          // account (e.g. it was just deleted). Creating one is an explicit act: ask for the credentials again. A cancel
          // leaves the app signed out - the old session is dropped first, so nothing stale is kept.
          await clearSession();
          const confirmed = await authorizeWithEntra(REAUTHENTICATION_PARAMETERS);
          if (!confirmed.accessToken || !confirmed.refreshToken) {
            throw new Error('Entra re-authentication completed without the tokens required for a session.');
          }
          await saveAuthorizedSession({
            accessToken: confirmed.accessToken,
            accessTokenExpirationDate: confirmed.accessTokenExpirationDate,
            refreshToken: confirmed.refreshToken,
            idToken: confirmed.idToken,
          });
          bootstrapResult = await bootstrapUserAccount(confirmed.accessToken);
          if (bootstrapResult.status === 'signInRequired') {
            await clearSession();
            throw new Error('Account creation was refused after a fresh sign-in.');
          }
        }
        setState(previous =>
          previous.isAuthenticated
            ? { ...previous, userBootstrapStatus: bootstrapResult.status, plan: bootstrapResult.plan, entitlement: bootstrapResult.entitlement, storeSubscription: bootstrapResult.storeSubscription ?? null, mobileVersionPolicy: bootstrapResult.mobileVersionPolicy, dataRetention: bootstrapResult.dataRetention ?? null, dataExportEnabled: bootstrapResult.dataExportEnabled ?? false }
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
        plan: null,
        entitlement: null,
        storeSubscription: null,
        mobileVersionPolicy: null,
        dataRetention: null,
        dataExportEnabled: false,
      }));
    }
  }, [t]);

  const signOut = useCallback(async () => {
    await unregisterCurrentPushDeviceBestEffort();
    await clearCollectionShortcutsOnLogoutBestEffort();
    await purgeLegacyCollectionLockSecrets();
    await clearSession();
    setSignedOut();
  }, [setSignedOut]);

  const completeAccountDeletion = useCallback(async () => {
    // The server deletion already succeeded: no local cleanup failure may turn that into anything but the sign-in screen, and nothing
    // here opens a browser (no end-session page, no account picker) - the person starts authentication from the landing screen.
    const attempt = async (step: () => unknown) => {
      try {
        await step();
      } catch {
        // best effort - see above
      }
    };
    await attempt(unregisterCurrentPushDeviceBestEffort);
    await attempt(clearCollectionShortcutsOnLogoutBestEffort);
    await attempt(purgeLegacyCollectionLockSecrets);
    await attempt(clearSession);
    setState(SIGNED_OUT_STATE);
  }, []);

  // Display-only - re-decoded from the always-fresh module-level cache rather than threaded through
  // AuthState/every setState call site above (a JWT decode is cheap, and this avoids every one of
  // this file's several setState calls needing to also remember to set an email field).
  const userEmail = useMemo(
    () => (state.isAuthenticated ? extractEmailClaim(decodeIdTokenClaims(getCachedIdToken() ?? '')) : null),
    [state.isAuthenticated],
  );

  const value = useMemo<AuthContextValue>(
    () => ({ ...state, signIn, signOut, completeAccountDeletion, getValidAccessToken, retryBootstrap, refreshEntitlement, userEmail }),
    [state, signIn, signOut, completeAccountDeletion, retryBootstrap, refreshEntitlement, userEmail],
  );

  return (
    <AuthContext.Provider value={value}>
      {children}
      {reauthRequired ? (
        <ConfirmDialog
          confirmLabel={t('auth.reauthRequiredAction')}
          destructive={false}
          dismissable={false}
          message={t('auth.reauthRequiredMessage')}
          onConfirm={() => {
            confirmReauthentication();
          }}
          title={t('auth.reauthRequiredTitle')}
          visible
        />
      ) : null}
    </AuthContext.Provider>
  );
}

/** The signed-in state when an AuthProvider is above, else undefined - for presentation-only widgets that must also render in isolation. */
export function useOptionalAuth(): AuthContextValue | undefined {
  return useContext(AuthContext);
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider.');
  }
  return context;
}
