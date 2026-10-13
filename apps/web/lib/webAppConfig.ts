/**
 * The signed-in Web app's public configuration, read at REQUEST time on the server (see app/(app)/layout.tsx) and handed to the
 * browser as plain props - never NEXT_PUBLIC_* (build-time inlining would break the one-image, runtime-configured deployment the
 * Dockerfile documents). Every value here is a public OAuth/URL identifier, not a secret: there is no client secret in a browser
 * app (Authorization Code + PKCE). Only the names in WEB_APP_CONFIG_ENV are ever read - never the whole environment.
 */
export interface WebAppConfig {
  readonly apiBaseUrl: string;
  readonly entraAuthority: string;
  /** The External ID tenant id: its tokens' issuer host is {tenantId}.ciamlogin.com (see knownAuthorityHosts). */
  readonly entraTenantId: string;
  readonly entraClientId: string;
  readonly entraApiScope: string;
  readonly webBaseUrl: string;
  /**
   * The host of the canonical Collection share links (https://<host>/c/{publicId}) - the Backend's PublicWeb:BaseUrl host, the
   * mobile JUPLE_PUBLIC_WEB_HOST. Optional: without it no pasted link is recognized as a Collection link here (the server still
   * refuses to save one as an ordinary link).
   */
  readonly publicWebHost: string | null;
  /**
   * Dev-only browser performance diagnostics (lib/perfDiagnostics.ts): JUPLE_WEB_PERF_DIAGNOSTICS=true. Off unless exactly "true"; a
   * Production deployment never sets it.
   */
  readonly perfDiagnostics: boolean;
}

export type WebAppConfigResult =
  | { readonly ok: true; readonly config: WebAppConfig }
  | { readonly ok: false; readonly missing: readonly string[] };

/** The only environment variables this app's sign-in reads. */
export const WEB_APP_CONFIG_ENV = {
  apiBaseUrl: 'JUPLE_API_BASE_URL',
  entraAuthority: 'JUPLE_ENTRA_AUTHORITY',
  entraTenantId: 'JUPLE_ENTRA_TENANT_ID',
  entraClientId: 'JUPLE_ENTRA_WEB_CLIENT_ID',
  entraApiScope: 'JUPLE_ENTRA_API_SCOPE',
  webBaseUrl: 'JUPLE_WEB_BASE_URL',
  publicWebHost: 'JUPLE_PUBLIC_WEB_HOST',
  perfDiagnostics: 'JUPLE_WEB_PERF_DIAGNOSTICS',
} as const;

/** Same default as the public viewer (app/c/[publicId]/page.tsx): the local Backend. */
const DEFAULT_API_BASE_URL = 'http://localhost:5092';

/** A bare host name (no scheme, path, port or user info) - anything else is no host. */
const PUBLIC_WEB_HOST_PATTERN = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$/i;

function parsePublicWebHost(value: string | undefined): string | null {
  return value && PUBLIC_WEB_HOST_PATTERN.test(value) ? value.toLowerCase() : null;
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, '');
}

/**
 * Pure: takes the environment as a parameter (testable) and picks only the known names. Sign-in values have no default -
 * a missing one is reported by name so the page can say sign-in is not configured instead of guessing a tenant.
 */
export function readWebAppConfig(env: Readonly<Record<string, string | undefined>>): WebAppConfigResult {
  const value = (name: string) => env[name]?.trim() || undefined;
  const authority = value(WEB_APP_CONFIG_ENV.entraAuthority);
  const tenantId = value(WEB_APP_CONFIG_ENV.entraTenantId);
  const clientId = value(WEB_APP_CONFIG_ENV.entraClientId);
  const apiScope = value(WEB_APP_CONFIG_ENV.entraApiScope);
  const webBaseUrl = value(WEB_APP_CONFIG_ENV.webBaseUrl);

  const missing = [
    [WEB_APP_CONFIG_ENV.entraAuthority, authority],
    [WEB_APP_CONFIG_ENV.entraTenantId, tenantId],
    [WEB_APP_CONFIG_ENV.entraClientId, clientId],
    [WEB_APP_CONFIG_ENV.entraApiScope, apiScope],
    [WEB_APP_CONFIG_ENV.webBaseUrl, webBaseUrl],
  ]
    .filter(([, found]) => !found)
    .map(([name]) => name as string);
  if (missing.length > 0) {
    return { ok: false, missing };
  }

  return {
    ok: true,
    config: {
      apiBaseUrl: trimTrailingSlash(value(WEB_APP_CONFIG_ENV.apiBaseUrl) ?? DEFAULT_API_BASE_URL),
      // MSAL wants the External ID authority with its trailing slash (https://<tenant>.ciamlogin.com/).
      entraAuthority: `${trimTrailingSlash(authority!)}/`,
      entraTenantId: tenantId!,
      entraClientId: clientId!,
      entraApiScope: apiScope!,
      webBaseUrl: trimTrailingSlash(webBaseUrl!),
      publicWebHost: parsePublicWebHost(value(WEB_APP_CONFIG_ENV.publicWebHost)),
      perfDiagnostics: value(WEB_APP_CONFIG_ENV.perfDiagnostics)?.toLowerCase() === 'true',
    },
  };
}

/** The dedicated MSAL redirect bridge page (app/auth/callback) - the only redirect URI registered for this app. */
export function redirectUriFor(config: WebAppConfig): string {
  return `${config.webBaseUrl}/auth/callback`;
}

/**
 * The hosts MSAL must trust: the authority's own (name-based, e.g. jupledev.ciamlogin.com) AND the tenant's GUID-based issuer host
 * ({tenantId}.ciamlogin.com). msal-browser 5 validates the discovery document's issuer against the authority; External ID answers a
 * name-based authority with a GUID-based issuer, which MSAL accepts only when that host is listed here (its documented rule for exactly
 * this case). Without it every sign-in fails before leaving the page (endpoints_resolution_error).
 */
export function knownAuthorityHosts(config: WebAppConfig): string[] {
  const authorityHost = new URL(config.entraAuthority).host;
  const issuerHost = `${config.entraTenantId}.ciamlogin.com`;
  return authorityHost === issuerHost ? [authorityHost] : [authorityHost, issuerHost];
}
