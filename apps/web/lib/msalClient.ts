import { BrowserCacheLocation, PublicClientApplication, type AccountInfo } from '@azure/msal-browser';
import { knownAuthorityHosts, redirectUriFor, type WebAppConfig } from './webAppConfig.ts';

/**
 * Browser-only MSAL (Authorization Code + PKCE, no client secret) for Microsoft Entra External ID. Imported only by Client
 * Components. Tokens live in MSAL's own cache - session storage (MSAL's default and the narrower choice: a tab's session ends with
 * the tab; Entra's own session still signs the person back in silently) - never in any storage of ours.
 *
 * Scopes: only the Juple API's access_as_user (MSAL adds openid / profile / offline_access itself). Microsoft Graph is never asked
 * for - the app needs no Graph data (who is signed in comes from the ID token, and the Juple account from the API).
 */
let instance: PublicClientApplication | null = null;
let initialization: Promise<PublicClientApplication> | null = null;
let initialized = false;

export function getMsal(config: WebAppConfig): Promise<PublicClientApplication> {
  if (initialization) {
    return initialization;
  }
  instance = new PublicClientApplication({
    auth: {
      clientId: config.entraClientId,
      authority: config.entraAuthority,
      knownAuthorities: knownAuthorityHosts(config),
      redirectUri: redirectUriFor(config),
      postLogoutRedirectUri: config.webBaseUrl,
    },
    cache: { cacheLocation: BrowserCacheLocation.SessionStorage },
  });
  const created = instance;
  initialization = created.initialize().then(() => {
    initialized = true;
    return created;
  });
  return initialization;
}

/** The MSAL instance once getMsal() has finished initializing it - null before (no token can be asked for yet). */
export function currentMsal(): PublicClientApplication | null {
  return instance && initialized ? instance : null;
}

export function apiScopes(config: WebAppConfig): string[] {
  return [config.entraApiScope];
}

/**
 * Finishes a redirect sign-in if this page load is the return from Entra (the /auth/callback bridge hands the response here), and
 * returns the signed-in account - the one just signed in, else the one already in MSAL's cache - or null.
 */
export async function resolveSignedInAccount(msal: PublicClientApplication): Promise<AccountInfo | null> {
  const result = await msal.handleRedirectPromise();
  const account = result?.account ?? msal.getActiveAccount() ?? msal.getAllAccounts()[0] ?? null;
  if (account) {
    msal.setActiveAccount(account);
  }
  return account;
}

/** An access token for the Juple API without any UI; null when only an interactive sign-in could get one (the session is gone). */
export async function acquireApiToken(
  msal: PublicClientApplication,
  config: WebAppConfig,
  forceRefresh: boolean,
): Promise<string | null> {
  const account = msal.getActiveAccount();
  if (!account) {
    return null;
  }
  try {
    const result = await msal.acquireTokenSilent({ account, scopes: apiScopes(config), forceRefresh });
    return result.accessToken || null;
  } catch {
    // Interaction required (expired refresh token, revoked consent ...) or the silent call failed: there is no usable session.
    return null;
  }
}
