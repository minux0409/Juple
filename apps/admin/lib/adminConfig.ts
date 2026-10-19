/**
 * The Admin Web's public configuration, read at REQUEST time on the server (app/(admin)/layout.tsx, proxy.ts) and handed to the
 * browser as plain props - never NEXT_PUBLIC_* (one image for every environment). Every value is a public OAuth/URL identifier:
 * there is no client secret in a browser app (Authorization Code + PKCE). Only the names in ADMIN_CONFIG_ENV are ever read.
 *
 * The Admin Web has its OWN Entra app registration (JUPLE_ADMIN_ENTRA_CLIENT_ID, redirect https://admin.<domain>/auth/callback) that
 * asks for the same Juple API scope as the user Web. Signing in proves only who the person is; whether they are an admin is decided
 * by the API (GET /api/v1/admin/me) from its own admin.AdminUsers table, never by anything in this app.
 */
export interface AdminConfig {
  readonly apiBaseUrl: string;
  readonly entraAuthority: string;
  /** The External ID tenant id: its tokens' issuer host is {tenantId}.ciamlogin.com (see knownAuthorityHosts). */
  readonly entraTenantId: string;
  readonly entraClientId: string;
  readonly entraApiScope: string;
  readonly adminBaseUrl: string;
  /** The deployed Admin Web build (e.g. the image tag), shown on 시스템 상태; null when the deployment does not say. */
  readonly buildVersion: string | null;
}

export type AdminConfigResult =
  | { readonly ok: true; readonly config: AdminConfig }
  | { readonly ok: false; readonly missing: readonly string[] };

export const ADMIN_CONFIG_ENV = {
  apiBaseUrl: 'JUPLE_ADMIN_API_BASE_URL',
  entraAuthority: 'JUPLE_ADMIN_ENTRA_AUTHORITY',
  entraTenantId: 'JUPLE_ADMIN_ENTRA_TENANT_ID',
  entraClientId: 'JUPLE_ADMIN_ENTRA_CLIENT_ID',
  entraApiScope: 'JUPLE_ADMIN_ENTRA_API_SCOPE',
  adminBaseUrl: 'JUPLE_ADMIN_BASE_URL',
  buildVersion: 'JUPLE_ADMIN_BUILD_VERSION',
} as const;

/** Picks only the known names from the real environment (the server never passes the whole environment anywhere). */
export function adminEnvFromProcess(): Record<string, string | undefined> {
  const env: Record<string, string | undefined> = {};
  for (const name of Object.values(ADMIN_CONFIG_ENV)) {
    env[name] = process.env[name];
  }
  return env;
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, '');
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:';
  } catch {
    return false;
  }
}

const URL_SETTINGS: readonly string[] = [ADMIN_CONFIG_ENV.apiBaseUrl, ADMIN_CONFIG_ENV.entraAuthority, ADMIN_CONFIG_ENV.adminBaseUrl];
const REQUIRED_SETTINGS: readonly string[] = [
  ...URL_SETTINGS,
  ADMIN_CONFIG_ENV.entraTenantId,
  ADMIN_CONFIG_ENV.entraClientId,
  ADMIN_CONFIG_ENV.entraApiScope,
];

/**
 * Pure (the environment is a parameter). Nothing has a default - not even the API address: an admin tool pointed at the wrong
 * environment is worse than one that says it is not configured. A missing or malformed value is reported by NAME only.
 */
export function readAdminConfig(env: Readonly<Record<string, string | undefined>>): AdminConfigResult {
  const value = (name: string) => env[name]?.trim() || undefined;
  const missing = REQUIRED_SETTINGS.filter(name => {
    const found = value(name);
    return !found || (URL_SETTINGS.includes(name) && !isHttpUrl(found));
  });
  if (missing.length > 0) {
    return { ok: false, missing };
  }

  return {
    ok: true,
    config: {
      apiBaseUrl: trimTrailingSlash(value(ADMIN_CONFIG_ENV.apiBaseUrl)!),
      // MSAL wants the External ID authority with its trailing slash (https://<tenant>.ciamlogin.com/).
      entraAuthority: `${trimTrailingSlash(value(ADMIN_CONFIG_ENV.entraAuthority)!)}/`,
      entraTenantId: value(ADMIN_CONFIG_ENV.entraTenantId)!,
      entraClientId: value(ADMIN_CONFIG_ENV.entraClientId)!,
      entraApiScope: value(ADMIN_CONFIG_ENV.entraApiScope)!,
      adminBaseUrl: trimTrailingSlash(value(ADMIN_CONFIG_ENV.adminBaseUrl)!),
      buildVersion: value(ADMIN_CONFIG_ENV.buildVersion)?.slice(0, 64) ?? null,
    },
  };
}

/** The dedicated MSAL redirect bridge page (app/auth/callback) - the only redirect URI registered for the Admin app. */
export function redirectUriFor(config: Pick<AdminConfig, 'adminBaseUrl'>): string {
  return `${config.adminBaseUrl}/auth/callback`;
}

/**
 * The hosts MSAL must trust: the authority's own host and the tenant's GUID-based issuer host ({tenantId}.ciamlogin.com) - External
 * ID answers a name-based authority with a GUID-based issuer (the same rule as the user Web, apps/web/lib/webAppConfig.ts).
 */
export function knownAuthorityHosts(config: Pick<AdminConfig, 'entraAuthority' | 'entraTenantId'>): string[] {
  const authorityHost = new URL(config.entraAuthority).host;
  const issuerHost = `${config.entraTenantId}.ciamlogin.com`;
  return authorityHost === issuerHost ? [authorityHost] : [authorityHost, issuerHost];
}
