/**
 * Microsoft Entra External ID configuration for Juple Mobile.
 *
 * Client ID, tenant ID, and redirect URI are public OAuth client identifiers,
 * not secrets, and may live in source. Values are centralized here so that
 * Dev/Dogfood/Production configuration can be swapped without touching UI code.
 *
 * Environment selection deliberately reuses the exact same __DEV__ / JUPLE_API_ENV signals as
 * src/api/apiConfig.ts's own resolveBaseUrl() (set by metro.dogfood.config.js /
 * metro.release.config.js, inlined by babel.config.js's transform-inline-environment-variables) -
 * Entra and the Backend API must never disagree on which environment a build is running as.
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

// The custom OAuth redirect scheme is a fixed, app-level identifier (see android/app/build.gradle's
// appAuthRedirectScheme manifest placeholder and ios/JupleMobile/Info.plist's CFBundleURLSchemes,
// both literally "com.juple.app.auth") - it does not depend on which Entra tenant/app registration
// is selected, so every environment shares this one value.
const ENTRA_REDIRECT_URL = 'com.juple.app.auth://oauthredirect';

const ENTRA_API_SCOPE_NAME = 'access_as_user';

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
  redirectUrl: ENTRA_REDIRECT_URL,
  scopes: ['openid', 'profile', 'offline_access', JUPLE_API_SCOPE],
};

/** Raw Production Entra values as read from the environment - none exist yet (see README.md). */
export interface ProductionEntraEnv {
  readonly instance?: string;
  readonly tenantId?: string;
  readonly apiClientId?: string;
  readonly nativeClientId?: string;
}

const PRODUCTION_ENTRA_ENV_VAR_NAMES: Record<keyof ProductionEntraEnv, string> = {
  instance: 'JUPLE_ENTRA_PROD_INSTANCE',
  tenantId: 'JUPLE_ENTRA_PROD_TENANT_ID',
  apiClientId: 'JUPLE_ENTRA_PROD_API_CLIENT_ID',
  nativeClientId: 'JUPLE_ENTRA_PROD_NATIVE_CLIENT_ID',
};

/**
 * Builds the Production Entra config from env-injected values (same mechanism as
 * JUPLE_API_BASE_URL - see apiConfig.ts and metro.release.config.js). Throws, naming exactly which
 * value(s) are missing, rather than ever falling back to entraDevAuthConfig - a Production release
 * must never silently authenticate against the Development tenant. metro.release.config.js already
 * refuses to bundle a release without all four values set, so reaching this function with a missing
 * value should not happen in practice - this is a second, defense-in-depth check at config-resolution
 * time, mirroring Program.cs's own startup fail-fast for Authentication:EntraExternalId:RequiredScope
 * on the Backend.
 */
export function buildProductionEntraAuthConfig(
  env: ProductionEntraEnv,
): EntraAuthConfig {
  const missing = (Object.keys(PRODUCTION_ENTRA_ENV_VAR_NAMES) as (keyof ProductionEntraEnv)[])
    .filter(key => !env[key])
    .map(key => PRODUCTION_ENTRA_ENV_VAR_NAMES[key]);

  if (missing.length > 0) {
    throw new Error(
      `Production Microsoft Entra configuration is incomplete - missing: ${missing.join(', ')}. ` +
        'Refusing to fall back to the Development Entra tenant.',
    );
  }

  const instanceOrigin = env.instance!.replace(/\/+$/, '');
  const tenantId = env.tenantId!;

  return {
    issuer: `https://${tenantId}.ciamlogin.com/${tenantId}/v2.0`,
    authorizationEndpoint: `${instanceOrigin}/${tenantId}/oauth2/v2.0/authorize`,
    tokenEndpoint: `${instanceOrigin}/${tenantId}/oauth2/v2.0/token`,
    endSessionEndpoint: `${instanceOrigin}/${tenantId}/oauth2/v2.0/logout`,
    clientId: env.nativeClientId!,
    redirectUrl: ENTRA_REDIRECT_URL,
    scopes: [
      'openid',
      'profile',
      'offline_access',
      `api://${env.apiClientId}/${ENTRA_API_SCOPE_NAME}`,
    ],
  };
}

export interface EntraEnvironmentSelection {
  readonly isDev: boolean;
  readonly apiEnv?: string;
  readonly productionEntraEnv: ProductionEntraEnv;
}

/**
 * Pure environment resolver, deliberately taking its inputs as parameters instead of reading
 * __DEV__/process.env directly - that keeps it unit-testable without depending on Babel's
 * build-time env-var inlining (which only ever applies inside the real Metro bundle, not in Jest's
 * module transform of this file). The actual app only ever calls this once, below, with the real
 * signals.
 */
export function resolveEntraAuthConfig(
  selection: EntraEnvironmentSelection,
): EntraAuthConfig {
  if (selection.isDev) {
    return entraDevAuthConfig;
  }

  // Dogfood is a real, standalone-installed test build (see android/app/build.gradle's dogfood
  // buildType) that talks to the Azure Development Backend - it must sign in against the same
  // Development Entra tenant, not Production.
  if (selection.apiEnv === 'dogfood') {
    return entraDevAuthConfig;
  }

  if (selection.apiEnv === 'production') {
    return buildProductionEntraAuthConfig(selection.productionEntraEnv);
  }

  // Unreachable given the two build-time gates above (see apiConfig.ts's own resolveBaseUrl()) -
  // throwing rather than guessing keeps a misconfigured build from silently picking any tenant.
  throw new Error(
    `Unrecognized Entra build environment (JUPLE_API_ENV=${selection.apiEnv ?? 'undefined'}).`,
  );
}

// RN's shared tsconfig deliberately restricts auto-included @types to ["jest"] (see
// @react-native/typescript-config), so this declares only the shape
// babel-plugin-transform-inline-environment-variables actually provides, scoped to this file alone -
// see src/api/apiConfig.ts for the same pattern.
declare const process: {
  readonly env: {
    readonly JUPLE_API_ENV?: string;
    readonly JUPLE_ENTRA_PROD_INSTANCE?: string;
    readonly JUPLE_ENTRA_PROD_TENANT_ID?: string;
    readonly JUPLE_ENTRA_PROD_API_CLIENT_ID?: string;
    readonly JUPLE_ENTRA_PROD_NATIVE_CLIENT_ID?: string;
  };
};

export const selectedEntraAuthConfig: EntraAuthConfig = resolveEntraAuthConfig({
  isDev: __DEV__,
  apiEnv: process.env.JUPLE_API_ENV,
  productionEntraEnv: {
    instance: process.env.JUPLE_ENTRA_PROD_INSTANCE,
    tenantId: process.env.JUPLE_ENTRA_PROD_TENANT_ID,
    apiClientId: process.env.JUPLE_ENTRA_PROD_API_CLIENT_ID,
    nativeClientId: process.env.JUPLE_ENTRA_PROD_NATIVE_CLIENT_ID,
  },
});
