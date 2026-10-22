'use client';

import type { AccountInfo } from '@azure/msal-browser';
import { useRouter } from 'next/navigation';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { PROFILE_PATH, type UserProfile } from '../../lib/accountDisplay';
import { createAppApi, type ApiTiming, type AppApi } from '../../lib/appApi';
import { forgetAllUnlocks } from '../../lib/collectionUnlock';
import { describeSignInError, signInFailureMessage } from '../../lib/authErrors';
import { isRtlLanguage, LANGUAGE_COOKIE, type AppDictionary, type AppLanguage, type LanguagePreference } from '../../lib/appI18n';
import { actionAfterAccountCreationRefused, bootstrapRequestBody, isAccountCreationRefused, isSessionLost, statusAfterBootstrapFailure, statusAfterInitialize, type AuthStatus } from '../../lib/authSession';
import {
  acquireApiToken,
  apiScopes,
  checkSession,
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
import { ACTIVE_CHECK_INTERVAL_MS, createSessionValidator, FOCUS_CHECK_INTERVAL_MS, type SessionValidator } from '../../lib/sessionValidation';
import { settleReauthenticationFailure } from '../../lib/reauthFailure';
import { parseDataExportEnabled, parseDataRetention, parseEntitlement, parseStoreSubscription, type DataRetention, type Entitlement, type StoreSubscription } from '../../lib/subscription';
import type { WebAppConfig } from '../../lib/webAppConfig';
import { AppShell } from './AppShell';
import { TourProvider } from './TourProvider';
import { isTermsRequired, parseTermsStatus, type TermsStatus } from '../../lib/safety';
import { SafetyProvider } from './SafetyProvider';
import { TermsAgreement } from './TermsAgreement';
import { ToastProvider } from './Toaster';
import { CenteredMessage, Landing, type BusinessFact } from './Landing';
import { MobileAppLanding, useContinueOnWeb } from './MobileAppLanding';
import type { AppDownload, MobileOs } from '../../lib/appDownload';
import { ReauthDialog } from './ReauthDialog';
import { clearStableImageUris } from '../../lib/stableImageUri';

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
  readonly dataRetention: DataRetention | null;
  readonly dataExportEnabled: boolean;
  /** The result of a same-account re-authentication this page load returned from (null = none), for the page that asked. */
  readonly reauthentication: ReauthenticationResult | null;
  readonly clearReauthentication: () => void;
  readonly reauthenticate: (purpose: ReauthenticationPurpose) => void;
  /** A page found the session gone (AuthExpiredError): ask the person to sign in again (one dialog, however many pages report it). */
  readonly onSessionLost: () => void;
  readonly signOut: () => void;
  /** The host of the canonical Collection share links (null = not configured: nothing pasted is taken for one). */
  readonly publicWebHost: string | null;
  readonly apiBaseUrl: string;
  /** Where to get the app (Google Play; the App Store only when a listing is configured). */
  readonly appDownload: AppDownload;
}

/** Exported only so the real-browser test (tests/browser) can mount the real pages with a stubbed API; app code uses useSignedInApp(). */
export const SignedInAppContext = createContext<SignedInApp | null>(null);

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
  businessFacts,
  appDownload,
  mobileOs,
  inAppBrowser,
  children,
}: {
  readonly config: WebAppConfig | null;
  readonly dictionary: AppDictionary;
  readonly language: AppLanguage;
  readonly languagePreference: LanguagePreference;
  readonly businessFacts: readonly BusinessFact[];
  readonly appDownload: AppDownload;
  /** A phone-sized mobile browser (null = desktop / tablet): it is offered the app before the Web. */
  readonly mobileOs: MobileOs | null;
  /** The phone's browser is an in-app / embedded one (KakaoTalk, ...): the landing adds one hint line for the app button. */
  readonly inAppBrowser: boolean;
  readonly children: React.ReactNode;
}) {
  const router = useRouter();
  const [continueOnWeb, chooseContinueOnWeb] = useContinueOnWeb();
  const [status, setStatus] = useState<AuthStatus>(config ? 'initializing' : 'configMissing');
  const [account, setAccount] = useState<AccountInfo | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [entitlement, setEntitlement] = useState<Entitlement | null>(null);
  const [storeSubscription, setStoreSubscription] = useState<StoreSubscription | null>(null);
  const [dataRetention, setDataRetention] = useState<DataRetention | null>(null);
  const [dataExportEnabled, setDataExportEnabled] = useState(false);
  const [reauthentication, setReauthentication] = useState<ReauthenticationResult | null>(null);
  // The Terms the server asks for and whether they were accepted (from the bootstrap). Until they are accepted the Agreement is the only
  // thing shown (before the shell, and so before the tutorial); a refusal for a NEWER Terms version brings it back the same way.
  const [terms, setTerms] = useState<TermsStatus | null>(null);
  // Entra no longer accepts this sign-in (e.g. the password was reset elsewhere): one non-dismissable "sign in again" dialog.
  const [reauthRequired, setReauthRequired] = useState(false);
  const [reauthBusy, setReauthBusy] = useState(false);
  const requireReauthentication = useCallback(() => setReauthRequired(true), []);
  const validatorRef = useRef<SessionValidator | null>(null);
  const rawApi = useMemo<AppApi | null>(() => {
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
  // Every call goes through here: a refusal for the missing Terms agreement brings the Agreement back (the call still fails as before).
  const api = useMemo<AppApi | null>(
    () =>
      rawApi
        ? (async request => {
            try {
              return await rawApi(request);
            } catch (error) {
              if (isTermsRequired(error)) {
                setTerms(previous => ({ currentVersion: previous?.currentVersion ?? '', acceptedVersion: previous?.acceptedVersion ?? null, isAccepted: false }));
              }
              throw error;
            }
          }) as AppApi
        : null,
    [rawApi],
  );

  const clearLocalSession = useCallback(async (message: string | null) => {
    const msal = currentMsal();
    if (msal) {
      // Local only (no Entra round trip): the tokens this tab held are dropped; the landing page then offers sign-in again.
      await msal.clearCache().catch(() => undefined);
      msal.setActiveAccount(null);
    }
    // Collection unlock grants and the kept signed photo URLs are this session's only.
    forgetAllUnlocks();
    clearStableImageUris();
    setAccount(null);
    setProfile(null);
    setEntitlement(null);
    setStoreSubscription(null);
    setDataRetention(null);
    setDataExportEnabled(false);
    setTerms(null);
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
      const result = await api<{ readonly entitlement?: unknown; readonly storeSubscription?: unknown; readonly terms?: unknown; readonly dataRetention?: unknown; readonly dataExport?: unknown } | undefined>({
        method: 'POST',
        path: '/api/v1/users/me/bootstrap',
        body: bootstrapRequestBody(navigator.language, Intl.DateTimeFormat().resolvedOptions().timeZone),
      });
      clearAccountCreationMarker();
      setEntitlement(parseEntitlement(result?.entitlement));
      setStoreSubscription(parseStoreSubscription(result?.storeSubscription));
      setDataRetention(parseDataRetention(result?.dataRetention));
      setDataExportEnabled(parseDataExportEnabled(result?.dataExport));
      setTerms(parseTermsStatus(result?.terms));
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
      if (isSessionLost(error)) {
        requireReauthentication();
        setStatus('signedOut');
        return;
      }
      setStatus(statusAfterBootstrapFailure(error));
    }
  }, [api, clearLocalSession, config, dictionary.sessionEnded, requireReauthentication]);

  // Session checks (see lib/sessionValidation.ts): right after the app is ready (a reload included), when the tab becomes visible or
  // focused again, and every few minutes while it is visible. Only an Entra answer of "sign in again" opens the dialog; a failure to
  // ask (offline, timeout) changes nothing.
  useEffect(() => {
    if (status !== 'ready' || !config) {
      return;
    }
    const validator =
      validatorRef.current ??
      (validatorRef.current = createSessionValidator({
        validate: async () => {
          const msal = currentMsal();
          return msal ? checkSession(msal, config) : 'transient';
        },
        onReauthRequired: requireReauthentication,
      }));
    void validator.check(FOCUS_CHECK_INTERVAL_MS);
    const onVisible = () => {
      if (document.visibilityState === 'visible') {
        void validator.check(FOCUS_CHECK_INTERVAL_MS);
      }
    };
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') {
        void validator.check(ACTIVE_CHECK_INTERVAL_MS);
      }
    }, FOCUS_CHECK_INTERVAL_MS);
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
    };
  }, [config, requireReauthentication, status]);

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
    clearStableImageUris();
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

  const onSessionLost = requireReauthentication;

  // 로그인하기: forget this tab's tokens and account (local only - Entra already ended the session), then sign in again and come back
  // to the same page. Nothing the page held (a half-written form) is kept.
  const confirmReauthentication = useCallback(async () => {
    const msal = currentMsal();
    if (!config || !msal) {
      return;
    }
    setReauthBusy(true);
    await clearLocalSession(null);
    validatorRef.current = null;
    setStatus('redirecting');
    try {
      await msal.loginRedirect({ scopes: apiScopes(config), redirectStartPage: window.location.href });
    } catch (error) {
      reportSignInError('loginRedirect', error);
      setReauthRequired(false);
      setReauthBusy(false);
      setNotice(signInFailureMessage(error, dictionary));
      setStatus('signedOut');
    }
  }, [clearLocalSession, config, dictionary]);

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
            dataRetention,
            dataExportEnabled,
            reauthentication,
            clearReauthentication,
            reauthenticate,
            onSessionLost,
            signOut,
            publicWebHost: config?.publicWebHost ?? null,
            apiBaseUrl: config!.apiBaseUrl,
            appDownload,
          }
        : null,
    [account, api, appDownload, clearReauthentication, config, dataExportEnabled, dataRetention, dictionary, entitlement, language, languagePreference, onSessionLost, profile, reauthenticate, reauthentication, setLanguagePreference, signOut, storeSubscription],
  );

  const content = (() => {
    // A phone gets the app first; "웹에서 계속하기" keeps the Web for this tab session. (Legal pages and share links are outside this app.)
    if (mobileOs && !continueOnWeb) {
      return <MobileAppLanding dictionary={dictionary} download={appDownload} inAppBrowser={inAppBrowser} onContinueOnWeb={chooseContinueOnWeb} os={mobileOs} publicWebHost={config?.publicWebHost ?? null} />;
    }
    if (status === 'configMissing') {
      return <CenteredMessage message={dictionary.configMissingMessage} title={dictionary.configMissingTitle} />;
    }
    if (status === 'signedOut') {
      return <Landing businessFacts={businessFacts} dictionary={dictionary} notice={notice} onSignIn={signIn} />;
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
    // Before the app shell: the current Terms come first. A missing Terms status (an older API) is never a reason to block.
    if (api && terms && !terms.isAccepted) {
      return (
        <TermsAgreement
          api={api}
          dictionary={dictionary}
          onAccepted={accepted => setTerms(accepted)}
          onSessionLost={onSessionLost}
          version={terms.currentVersion}
        />
      );
    }
    return (
      <SignedInAppContext.Provider value={signedInApp}>
        <TourProvider>
          <ToastProvider>
            <SafetyProvider>
              <AppShell>{children}</AppShell>
            </SafetyProvider>
          </ToastProvider>
        </TourProvider>
      </SignedInAppContext.Provider>
    );
  })();

  // The chosen language's direction (Arabic is right-to-left, as on mobile); user-written text keeps dir="auto" where shown.
  return (
    <div dir={isRtlLanguage(language) ? 'rtl' : 'ltr'} lang={language}>
      {content}
      <ReauthDialog busy={reauthBusy} dictionary={dictionary} onConfirm={() => void confirmReauthentication()} open={reauthRequired} />
    </div>
  );
}
