import { BrowserCacheLocation, PublicClientApplication, type AccountInfo } from '@azure/msal-browser';
import { classifyTokenFailure, TokenUnavailableError, type SessionCheck } from './sessionValidation.ts';
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
 *
 * A return from a re-authentication (see startReauthentication) never switches accounts: the result belongs to the session only
 * when it is the SAME account (tenant + object id); otherwise the original account stays active and the outcome says so.
 */
export async function resolveSignedInAccount(msal: PublicClientApplication): Promise<{ readonly account: AccountInfo | null; readonly reauthentication: ReauthenticationResult | null }> {
  const pending = takePendingReauthentication();
  let result: Awaited<ReturnType<PublicClientApplication['handleRedirectPromise']>>;
  try {
    result = await msal.handleRedirectPromise();
  } catch (error) {
    if (!pending) {
      throw error;
    }
    // The re-authentication was cancelled or failed at Entra: the existing session simply continues.
    const original = findAccount(msal, pending.homeAccountId);
    if (original) {
      msal.setActiveAccount(original);
    }
    return { account: original, reauthentication: { purpose: pending.purpose, outcome: 'incomplete' } };
  }
  if (pending) {
    const original = findAccount(msal, pending.homeAccountId);
    const returned = result?.account ?? null;
    const same = original !== null && returned !== null && sameAccount(original, returned);
    const account = original ?? returned;
    if (account) {
      msal.setActiveAccount(account);
    }
    return { account, reauthentication: { purpose: pending.purpose, outcome: result === null ? 'incomplete' : same ? 'reauthenticated' : 'differentAccount' } };
  }
  const account = result?.account ?? msal.getActiveAccount() ?? msal.getAllAccounts()[0] ?? null;
  if (account) {
    msal.setActiveAccount(account);
  }
  return { account, reauthentication: null };
}

// ---- re-authentication: "sign in again to confirm it's you" (mobile auth/reauthentication.ts) ------------------------------------

/** What the fresh sign-in is for - the page that asked continues only with its own purpose. */
export type ReauthenticationPurpose = 'collectionLockSetup' | 'collectionLockReset' | 'deleteAccount' | 'passwordReset';

export interface ReauthenticationResult {
  readonly purpose: ReauthenticationPurpose;
  readonly outcome: 'reauthenticated' | 'differentAccount' | 'incomplete';
}

const PENDING_REAUTH_KEY = 'juple.web.pendingReauthentication';
const PURPOSES: readonly ReauthenticationPurpose[] = ['collectionLockSetup', 'collectionLockReset', 'deleteAccount', 'passwordReset'];

/** The same person: tenant + object id (MSAL's localAccountId) - never the e-mail, which can change. */
export function sameAccount(a: Pick<AccountInfo, 'tenantId' | 'localAccountId'>, b: Pick<AccountInfo, 'tenantId' | 'localAccountId'>): boolean {
  return Boolean(a.tenantId && a.localAccountId) && a.tenantId === b.tenantId && a.localAccountId === b.localAccountId;
}

function findAccount(msal: PublicClientApplication, homeAccountId: string): AccountInfo | null {
  return msal.getAllAccounts().find(candidate => candidate.homeAccountId === homeAccountId) ?? null;
}

function takePendingReauthentication(): { purpose: ReauthenticationPurpose; homeAccountId: string } | null {
  try {
    const raw = window.sessionStorage.getItem(PENDING_REAUTH_KEY);
    window.sessionStorage.removeItem(PENDING_REAUTH_KEY);
    const parsed = raw ? (JSON.parse(raw) as { purpose?: unknown; homeAccountId?: unknown }) : null;
    return parsed && PURPOSES.includes(parsed.purpose as ReauthenticationPurpose) && typeof parsed.homeAccountId === 'string'
      ? { purpose: parsed.purpose as ReauthenticationPurpose, homeAccountId: parsed.homeAccountId }
      : null;
  } catch {
    return null;
  }
}

const ACCOUNT_CREATION_KEY = 'juple.web.accountCreationCredentialsAsked';

/** This tab already sent the person to type their credentials because the API refused to create an account from an old sign-in. */
export function markAccountCreationAsked(): void {
  try {
    window.sessionStorage.setItem(ACCOUNT_CREATION_KEY, '1');
  } catch {
    // Without session storage the guard degrades to "ask again" - one extra sign-in, never a loop (the next refusal after this one signs out only if the marker holds).
  }
}

/** Reads and clears the marker: true when the credentials were already asked for in this tab. */
export function takeAccountCreationMarker(): boolean {
  try {
    const asked = window.sessionStorage.getItem(ACCOUNT_CREATION_KEY) === '1';
    window.sessionStorage.removeItem(ACCOUNT_CREATION_KEY);
    return asked;
  } catch {
    return false;
  }
}

export function clearAccountCreationMarker(): void {
  takeAccountCreationMarker();
}

/** Forgets a fresh sign-in that never left this page (cancelled before / while leaving): its marker must not outlive the attempt. */
export function clearPendingReauthentication(): void {
  try {
    window.sessionStorage.removeItem(PENDING_REAUTH_KEY);
  } catch {
    // Session storage unavailable: there is no marker to clear.
  }
}

/** One local part, one @, a dotted domain - the login_hint is only a convenience for the sign-in page (mobile loginHintFromIdToken). */
function loginHint(account: AccountInfo): string | undefined {
  const value = account.username?.trim();
  return value && value.length <= 254 && /^[^s@<>"']+@[^s@<>"']+.[^s@<>"']+$/.test(value) ? value : undefined;
}

/**
 * Starts a fresh interactive sign-in of the SAME account (prompt=login) and comes back to this page. Whether it was recent enough is
 * decided by the server from the new access token, never here. Only the purpose and which account to keep are remembered for the
 * return (this tab's session storage) - no token, no password.
 */
export async function startReauthentication(msal: PublicClientApplication, config: WebAppConfig, purpose: ReauthenticationPurpose): Promise<void> {
  const account = msal.getActiveAccount();
  if (!account) {
    return;
  }
  window.sessionStorage.setItem(PENDING_REAUTH_KEY, JSON.stringify({ purpose, homeAccountId: account.homeAccountId }));
  await msal.acquireTokenRedirect({
    scopes: apiScopes(config),
    account,
    prompt: 'login',
    loginHint: loginHint(account),
    redirectStartPage: window.location.href,
  });
}

/**
 * An access token for the Juple API without any UI; null when only an interactive sign-in could get one (the session is gone).
 * Any other failure (offline, timeout, Entra unreachable) throws TokenUnavailableError - the session is kept and the call can be retried.
 */
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
  } catch (error) {
    if (classifyTokenFailure(error) === 'reauthRequired') {
      return null;
    }
    throw new TokenUnavailableError();
  }
}

/**
 * Whether Entra still accepts this sign-in: a forced silent refresh (skips the cached access token, which outlives a revocation).
 * Used only by the session checks in AppRoot - never per API call. The token itself is not kept or shown here.
 */
export async function checkSession(msal: PublicClientApplication, config: WebAppConfig): Promise<SessionCheck> {
  const account = msal.getActiveAccount();
  if (!account) {
    return 'reauthRequired';
  }
  try {
    await msal.acquireTokenSilent({ account, scopes: apiScopes(config), forceRefresh: true });
    return 'valid';
  } catch (error) {
    return classifyTokenFailure(error);
  }
}
