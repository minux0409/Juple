/**
 * Microsoft Entra External ID configuration for Juple Mobile (Development tenant).
 *
 * Client ID, tenant ID, and redirect URI are public OAuth client identifiers,
 * not secrets, and may live in source. Values are centralized here so that
 * Dev/Staging/Production configuration can be swapped without touching UI code.
 */

export interface EntraAuthConfig {
  readonly issuer: string;
  readonly authorizationEndpoint: string;
  readonly tokenEndpoint: string;
  readonly endSessionEndpoint: string;
  readonly clientId: string;
  readonly redirectUrl: string;
  readonly scopes: readonly string[];
}

const JUPLE_API_SCOPE =
  'api://14bcc3b7-7b37-4051-9e40-63cc2a5ffc8b/access_as_user';

/**
 * Confirmed via GET https://jupledev.ciamlogin.com/{tenantId}/v2.0/.well-known/openid-configuration
 */
export const entraDevAuthConfig: EntraAuthConfig = {
  issuer:
    'https://d2e79a05-cf5f-43ab-86d2-717e025a74b1.ciamlogin.com/d2e79a05-cf5f-43ab-86d2-717e025a74b1/v2.0',
  authorizationEndpoint:
    'https://jupledev.ciamlogin.com/d2e79a05-cf5f-43ab-86d2-717e025a74b1/oauth2/v2.0/authorize',
  tokenEndpoint:
    'https://jupledev.ciamlogin.com/d2e79a05-cf5f-43ab-86d2-717e025a74b1/oauth2/v2.0/token',
  endSessionEndpoint:
    'https://jupledev.ciamlogin.com/d2e79a05-cf5f-43ab-86d2-717e025a74b1/oauth2/v2.0/logout',
  clientId: 'c516017f-437c-43f5-966c-c2f0014cd185',
  redirectUrl: 'com.juple.app.auth://oauthredirect',
  scopes: ['openid', 'profile', 'offline_access', JUPLE_API_SCOPE],
};
