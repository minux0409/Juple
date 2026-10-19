import { BrowserCacheLocation, PublicClientApplication, type AccountInfo } from '@azure/msal-browser';
import { knownAuthorityHosts, redirectUriFor, type AdminConfig } from './adminConfig.ts';
import { classifyTokenFailure, TokenUnavailableError } from './tokenFailure.ts';

/**
 * Browser-only MSAL (Authorization Code + PKCE, no client secret) for Microsoft Entra External ID. Tokens live only in MSAL's own
 * cache in SESSION storage (a tab's admin session ends with the tab) - never in any storage of ours, never logged or shown.
 * Scopes: only the Juple API's access_as_user (MSAL adds openid / profile / offline_access); Microsoft Graph is never asked for.
 */
let initialization: Promise<PublicClientApplication> | null = null;

export function getMsal(config: AdminConfig): Promise<PublicClientApplication> {
  if (!initialization) {
    const instance = new PublicClientApplication({
      auth: {
        clientId: config.entraClientId,
        authority: config.entraAuthority,
        knownAuthorities: knownAuthorityHosts(config),
        redirectUri: redirectUriFor(config),
        postLogoutRedirectUri: config.adminBaseUrl,
      },
      cache: { cacheLocation: BrowserCacheLocation.SessionStorage },
    });
    initialization = instance.initialize().then(() => instance);
  }
  return initialization;
}

/** Finishes a redirect sign-in if this load is the return from Entra, and returns the signed-in account (or null). */
export async function resolveSignedInAccount(msal: PublicClientApplication): Promise<AccountInfo | null> {
  const result = await msal.handleRedirectPromise();
  const account = result?.account ?? msal.getActiveAccount() ?? msal.getAllAccounts()[0] ?? null;
  if (account) {
    msal.setActiveAccount(account);
  }
  return account;
}

export async function signIn(msal: PublicClientApplication, config: AdminConfig): Promise<void> {
  await msal.loginRedirect({ scopes: [config.entraApiScope], redirectStartPage: window.location.href });
}

export async function signOut(msal: PublicClientApplication): Promise<void> {
  const account = msal.getActiveAccount() ?? undefined;
  await msal.logoutRedirect({ account });
}

/**
 * An access token for the Juple API without UI; null when only an interactive sign-in could get one. Any other failure throws
 * TokenUnavailableError (the session is kept; the call can be retried).
 */
export async function acquireApiToken(msal: PublicClientApplication, config: AdminConfig, forceRefresh: boolean): Promise<string | null> {
  const account = msal.getActiveAccount();
  if (!account) {
    return null;
  }
  try {
    const result = await msal.acquireTokenSilent({ account, scopes: [config.entraApiScope], forceRefresh });
    return result.accessToken || null;
  } catch (error) {
    if (classifyTokenFailure(error) === 'reauthRequired') {
      return null;
    }
    throw new TokenUnavailableError();
  }
}
