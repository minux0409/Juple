'use client';

import type { AccountInfo } from '@azure/msal-browser';
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { PROFILE_PATH, type UserProfile } from '../../lib/accountDisplay';
import { createAppApi, type AppApi } from '../../lib/appApi';
import { describeSignInError, signInFailureMessage } from '../../lib/authErrors';
import type { AppDictionary } from '../../lib/appI18n';
import { bootstrapRequestBody, statusAfterBootstrapFailure, statusAfterInitialize, type AuthStatus } from '../../lib/authSession';
import type { Locale } from '../../lib/i18n';
import { acquireApiToken, apiScopes, currentMsal, getMsal, resolveSignedInAccount } from '../../lib/msalClient';
import type { WebAppConfig } from '../../lib/webAppConfig';
import { AppShell } from './AppShell';
import { CenteredMessage, Landing } from './Landing';

interface SignedInApp {
  readonly api: AppApi;
  readonly dictionary: AppDictionary;
  readonly locale: Locale;
  readonly account: AccountInfo;
  /** The Juple profile (nickname / Juple ID) - null until loaded or if it could not be (the label then falls back). */
  readonly profile: UserProfile | null;
  /** A page found the session gone (AuthExpiredError): sign out locally and show the landing page. */
  readonly onSessionLost: () => void;
  readonly signOut: () => void;
}

const SignedInAppContext = createContext<SignedInApp | null>(null);

/** Development only: the failure's name / code / sub-error / correlation id - never its message or any token. */
function reportSignInError(step: string, error: unknown): void {
  if (process.env.NODE_ENV !== 'production') {
    console.error('[Juple sign-in]', step, JSON.stringify(describeSignInError(error)));
  }
}

/** For pages inside the signed-in app (always rendered under a ready session). */
export function useSignedInApp(): SignedInApp {
  const value = useContext(SignedInAppContext);
  if (!value) {
    throw new Error('useSignedInApp must be used inside the signed-in app.');
  }
  return value;
}

export function AppRoot({
  config,
  dictionary,
  locale,
  children,
}: {
  readonly config: WebAppConfig | null;
  readonly dictionary: AppDictionary;
  readonly locale: Locale;
  readonly children: React.ReactNode;
}) {
  const [status, setStatus] = useState<AuthStatus>(config ? 'initializing' : 'configMissing');
  const [account, setAccount] = useState<AccountInfo | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const api = useMemo<AppApi | null>(() => {
    if (!config) {
      return null;
    }
    return createAppApi({
      apiBaseUrl: config.apiBaseUrl,
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
    setAccount(null);
    setProfile(null);
    setNotice(message);
    setStatus('signedOut');
  }, []);

  const bootstrap = useCallback(async () => {
    if (!api) {
      return;
    }
    setStatus('bootstrapping');
    try {
      await api({
        method: 'POST',
        path: '/api/v1/users/me/bootstrap',
        body: bootstrapRequestBody(navigator.language, Intl.DateTimeFormat().resolvedOptions().timeZone),
      });
      setStatus('ready');
      // Best effort, after the account exists: who to show (the mobile 내 페이지's own source). A failure only leaves the fallback label.
      api<UserProfile>({ path: PROFILE_PATH }).then(setProfile, () => undefined);
    } catch (error) {
      const next = statusAfterBootstrapFailure(error);
      if (next === 'signedOut') {
        await clearLocalSession(dictionary.sessionEnded);
      } else {
        setStatus(next);
      }
    }
  }, [api, clearLocalSession, dictionary.sessionEnded]);

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
        setAccount(signedIn);
        const next = statusAfterInitialize(signedIn !== null);
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
      await msal.loginRedirect({ scopes: apiScopes(config) });
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

  const onSessionLost = useCallback(() => {
    void clearLocalSession(dictionary.sessionEnded);
  }, [clearLocalSession, dictionary.sessionEnded]);

  const signedInApp = useMemo<SignedInApp | null>(
    () => (api && account ? { api, dictionary, locale, account, profile, onSessionLost, signOut } : null),
    [account, api, dictionary, locale, onSessionLost, profile, signOut],
  );

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
}
