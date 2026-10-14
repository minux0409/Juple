'use client';

import type { AccountInfo } from '@azure/msal-browser';
import { useRouter } from 'next/navigation';
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { PROFILE_PATH, type UserProfile } from '../../lib/accountDisplay';
import { createAppApi, type ApiTiming, type AppApi } from '../../lib/appApi';
import { forgetAllUnlocks } from '../../lib/collectionUnlock';
import { describeSignInError, signInFailureMessage } from '../../lib/authErrors';
import { isRtlLanguage, LANGUAGE_COOKIE, type AppDictionary, type AppLanguage, type LanguagePreference } from '../../lib/appI18n';
import { actionAfterAccountCreationRefused, bootstrapRequestBody, isAccountCreationRefused, statusAfterBootstrapFailure, statusAfterInitialize, type AuthStatus } from '../../lib/authSession';
import {
  acquireApiToken,
  apiScopes,
  clearAccountCreationMarker,
  markAccountCreationAsked,
  takeAccountCreationMarker,
  currentMsal,
  getMsal,
  resolveSignedInAccount,
  clearPendingReauthentication,
  startReauthentication,
  type ReauthenticationPurpose,
  type ReauthenticationResult,
} from '../../lib/msalClient';
import { getPerfRecorder } from '../../lib/perfDiagnostics';
import { settleReauthenticationFailure } from '../../lib/reauthFailure';
import { parseEntitlement, parseStoreSubscription, type Entitlement, type StoreSubscription } from '../../lib/subscription';
import type { WebAppConfig } from '../../lib/webAppConfig';
import { AppShell } from './AppShell';
import { CenteredMessage, Landing } from './Landing';

interface SignedInApp {
  readonly api: AppApi;
  readonly dictionary: AppDictionary;
  /** The language the page is shown in (Intl formatting uses it too). */
  readonly locale: AppLanguage;
  readonly languagePreference: LanguagePreference;
  /** Saves the 언어 choice for this browser and re-renders the app in it. */
  readonly setLanguagePreference: (preference: LanguagePreference) => void;
  readonly account: AccountInfo;
  /** The Juple profile (nickname / Juple ID / photo) - null until loaded or if it could not be (the label then falls back). */
  readonly profile: UserProfile | null;
  /** The server's answer after a profile change (e.g. a new nickname) - shown everywhere at once. */
  readonly updateProfile: (profile: UserProfile) => void;
  /** The bootstrap's subscription facts (null = not reported). */
  readonly entitlement: Entitlement | null;
  readonly storeSubscription: StoreSubscription | null;
  /** The result of a same-account re-authentication this page load returned from (null = none), for the page that asked. */
  readonly reauthentication: ReauthenticationResult | null;
  readonly clearReauthentication: () => void;
  readonly reauthenticate: (purpose: ReauthenticationPurpose) => void;
  /** A page found the session gone (AuthExpiredError): sign out locally and show the landing page. */
  readonly onSessionLost: () => void;
  readonly signOut: () => void;
  /** The host of the canonical Collection share links (null = not configured: nothing pasted is taken for one). */
  readonly publicWebHost: string | null;
}

const SignedInAppContext = createContext<SignedInApp | null>(null);

/** Development only: the failure's name / code / sub-error / correlation id - never its message or any token. */
function reportSignInError(step: string, error: unknown): void {
  if (process.env.NODE_ENV !== 'production') {
    console.error('[Juple sign-in]', step, JSON.stringify(describeSignInError(error)));
  }
}

/**
 * Development under `next dev`: where each API call spent its time (path and parameter NAMES, milliseconds - never a value or a token).
 * The deployed Dev site is a production build, so there the same measurement is switched on by JUPLE_WEB_PERF_DIAGNOSTICS=true
 * (config.perfDiagnostics - lib/perfDiagnostics.ts); Production never sets it and measures nothing.
 */
const reportApiTimingInDevelopment: ((timing: ApiTiming) => void) | undefined =
  process.env.NODE_ENV !== 'production'
    ? timing => {
        console.debug('[Juple api]', timing.method, timing.path, timing.queryKeys.join(','), `${timing.status ?? '-'}`, `token ${timing.tokenMs}ms | wait ${timing.waitMs}ms | body ${timing.bodyMs}ms | total ${timing.totalMs}ms`);
      }
    : undefined;

/** For pages inside the signed-in app (always rendered under a ready session). */
export function useSignedInApp(): SignedInApp {
  const value = useContext(SignedInAppContext);
  if (!value) {
    throw new Error('useSignedInApp must be used inside the signed-in app.');
  }
  return value;
}

/** One year; SameSite=Lax; path=/ - a display preference only (no account data). */
function writeLanguageCookie(preference: LanguagePreference): void {
  document.cookie =
    preference === 'system' ? `${LANGUAGE_COOKIE}=; path=/; max-age=0; samesite=lax` : `${LANGUAGE_COOKIE}=${encodeURIComponent(preference)}; path=/; max-age=31536000; samesite=lax`;
}

export function AppRoot({
  config,
  dictionary,
  language,
  languagePreference,
  children,
}: {
  readonly config: WebAppConfig | null;
  readonly dictionary: AppDictionary;
  readonly language: AppLanguage;
  readonly languagePreference: LanguagePreference;
  readonly children: React.ReactNode;
}) {
  const router = useRouter();
  const [status, setStatus] = useState<AuthStatus>(config ? 'initializing' : 'configMissing');
  const [account, setAccount] = useState<AccountInfo | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [entitlement, setEntitlement] = useState<Entitlement | null>(null);
  const [storeSubscription, setStoreSubscription] = useState<StoreSubscription | null>(null);
  const [reauthentication, setReauthentication] = useState<ReauthenticationResult | null>(null);
  const api = useMemo<AppApi | null>(() => {
    if (!config) {
      return null;
    }
    const perf = config.perfDiagnostics ? getPerfRecorder() : null;
    return createAppApi({
      apiBaseUrl: config.apiBaseUrl,
      onTiming: perf ? timing => perf.onApiTiming(timing) : reportApiTimingInDevelopment,
      getAccessToken: async ({ forceRefresh }) => {
        const msal = currentMsal();
        return msal ? acquireApiToken(msal, config, forceRefresh) : null;
      },
    });
  }, [config]);

  const clearLocalSession = useCallback(async (message: string | null) => {
    const msal = currentMsal();
    if (msal) {
      // Local only (no Entra round trip): the tokens this tab held are dropped; the landing page then offers sign-in again.
      await msal.clearCache().catch(() => undefined);
      msal.setActiveAccount(null);
    }
    // Collection unlock grants are this session's only.
    forgetAllUnlocks();
    setAccount(null);
    setProfile(null);
    setEntitlement(null);
    setStoreSubscription(null);
    setNotice(message);
    setStatus('signedOut');
  }, []);

  const bootstrap = useCallback(async () => {
    if (!api) {
      return;
    }
    setStatus('bootstrapping');
    if (config?.perfDiagnostics) {
      getPerfRecorder().mark('bootstrapStart');
    }
    try {
      const result = await api<{ readonly entitlement?: unknown; readonly storeSubscription?: unknown } | undefined>({
        method: 'POST',
        path: '/api/v1/users/me/bootstrap',
        body: bootstrapRequestBody(navigator.language, Intl.DateTimeFormat().resolvedOptions().timeZone),
      });
      clearAccountCreationMarker();
      setEntitlement(parseEntitlement(result?.entitlement));
      setStoreSubscription(parseStoreSubscription(result?.storeSubscription));
      setStatus('ready');
      // Best effort, after the account exists: who to show (the mobile 내 페이지's own source). A failure only leaves the fallback label.
      api<UserProfile>({ path: PROFILE_PATH }).then(setProfile, () => undefined);
    } catch (error) {
      if (isAccountCreationRefused(error)) {
        // No Juple account for this sign-in and the sign-in is old: never create one silently. Ask for the credentials once.
        const msal = currentMsal();
        const account = msal?.getActiveAccount();
        const action = actionAfterAccountCreationRefused(takeAccountCreationMarker());
        if (action === 'askForCredentials' && msal && account && config) {
          markAccountCreationAsked();
          setStatus('redirecting');
          msal
            .acquireTokenRedirect({ scopes: apiScopes(config), account, prompt: 'login', redirectStartPage: window.location.href })
            .catch(() => void clearLocalSession(dictionary.sessionEnded));
          return;
        }
        await clearLocalSession(dictionary.sessionEnded);
        return;
      }
      const next = statusAfterBootstrapFailure(error);
      if (next === 'signedOut') {
        await clearLocalSession(dictionary.sessionEnded);
      } else {
        setStatus(next);
      }
    }
  }, [api, clearLocalSession, config, dictionary.sessionEnded]);

  useEffect(() => {
    if (!config) {
      return;
    }
    let active = true;
    (async () => {
      try {
        const msal = await getMsal(config);
        const signedIn = await resolveSignedInAccount(msal);
        if (!active) {
          return;
        }
        if (config.perfDiagnostics) {
          // MSAL initialized and the signed-in account resolved (any redirect handled): the sign-in part of the wait is over.
          getPerfRecorder().mark('authReady');
        }
        setAccount(signedIn.account);
        setReauthentication(signedIn.reauthentication);
        const next = statusAfterInitialize(signedIn.account !== null);
        if (next === 'bootstrapping') {
          await bootstrap();
        } else {
          setStatus(next);
        }
      } catch (error) {
        reportSignInError('initialize', error);
        if (active) {
          setNotice(signInFailureMessage(error, dictionary));
          setStatus('signedOut');
        }
      }
    })();
    return () => {
      active = false;
    };
    // Runs once per page load: MSAL is a singleton and finishes any pending redirect here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config]);

  const signIn = useCallback(async () => {
    const msal = currentMsal();
    if (!config || !msal) {
      return;
    }
    setNotice(null);
    setStatus('redirecting');
    try {
      // Back to exactly the page that asked (e.g. a /shared/{publicId} share link opened while signed out) once Entra is done.
      await msal.loginRedirect({ scopes: apiScopes(config), redirectStartPage: window.location.href });
    } catch (error) {
      reportSignInError('loginRedirect', error);
      setNotice(signInFailureMessage(error, dictionary));
      setStatus('signedOut');
    }
  }, [config, dictionary]);

  const signOut = useCallback(() => {
    const msal = currentMsal();
    if (!msal || !config) {
      return;
    }
    setStatus('redirecting');
    // Clears MSAL's cache for this account and ends the Entra session, then returns to the start page (postLogoutRedirectUri).
    msal.logoutRedirect({ account: msal.getActiveAccount() ?? undefined, postLogoutRedirectUri: config.webBaseUrl }).catch(() => {
      void clearLocalSession(null);
    });
  }, [clearLocalSession, config]);

  const reauthenticate = useCallback(
    (purpose: ReauthenticationPurpose) => {
      const msal = currentMsal();
      if (!msal || !config) {
        return;
      }
      setStatus('redirecting');
      startReauthentication(msal, config, purpose).catch(error => {
        settleReauthenticationFailure(error, purpose, {
          clearMarker: clearPendingReauthentication,
          report: reportSignInError,
          setResult: setReauthentication,
          backToReady: () => setStatus('ready'),
        });
      });
    },
    [config],
  );

  const onSessionLost = useCallback(() => {
    void clearLocalSession(dictionary.sessionEnded);
  }, [clearLocalSession, dictionary.sessionEnded]);

  const setLanguagePreference = useCallback(
    (preference: LanguagePreference) => {
      writeLanguageCookie(preference);
      // The server renders the layout again in the chosen language; client state (session, profile) is kept.
      router.refresh();
    },
    [router],
  );

  const clearReauthentication = useCallback(() => setReauthentication(null), []);

  const signedInApp = useMemo<SignedInApp | null>(
    () =>
      api && account
        ? {
            api,
            dictionary,
            locale: language,
            languagePreference,
            setLanguagePreference,
            account,
            profile,
            updateProfile: setProfile,
            entitlement,
            storeSubscription,
            reauthentication,
            clearReauthentication,
            reauthenticate,
            onSessionLost,
            signOut,
            publicWebHost: config?.publicWebHost ?? null,
          }
        : null,
    [account, api, clearReauthentication, config, dictionary, entitlement, language, languagePreference, onSessionLost, profile, reauthenticate, reauthentication, setLanguagePreference, signOut, storeSubscription],
  );

  const content = (() => {
    if (status === 'configMissing') {
      return <CenteredMessage message={dictionary.configMissingMessage} title={dictionary.configMissingTitle} />;
    }
    if (status === 'signedOut') {
      return <Landing dictionary={dictionary} notice={notice} onSignIn={signIn} />;
    }
    if (status === 'bootstrapFailed') {
      return (
        <CenteredMessage
          action={{ label: dictionary.retry, onPress: () => void bootstrap() }}
          message={dictionary.loadFailedMessage}
          title={dictionary.loadFailedTitle}
        />
      );
    }
    if (status !== 'ready' || !signedInApp) {
      return <CenteredMessage busy message={status === 'redirecting' ? dictionary.signingIn : dictionary.checkingLogin} />;
    }
    return (
      <SignedInAppContext.Provider value={signedInApp}>
        <AppShell>{children}</AppShell>
      </SignedInAppContext.Provider>
    );
  })();

  // The chosen language's direction (Arabic is right-to-left, as on mobile); user-written text keeps dir="auto" where shown.
  return (
    <div dir={isRtlLanguage(language) ? 'rtl' : 'ltr'} lang={language}>
      {content}
    </div>
  );
}
