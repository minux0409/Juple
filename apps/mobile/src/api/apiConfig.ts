/**
 * Resolves which Backend this build talks to. Exactly one of three paths, in order:
 *
 * 1. Local Development (__DEV__ true - the ordinary `npm run android` + Metro workflow):
 *    always http://localhost:5092, unchanged from before.
 * 2. Dogfood (__DEV__ false, JUPLE_API_ENV === 'dogfood'): the Azure Development Backend.
 *    JUPLE_API_ENV is inlined into the bundle at build time by
 *    babel-plugin-transform-inline-environment-variables (see babel.config.js) - only the
 *    Android "dogfood" buildType's bundle command sets it (see
 *    android/app/build.gradle + metro.dogfood.config.js). It does not exist in any other build.
 * 3. Production (__DEV__ false, JUPLE_API_ENV === 'production'): JUPLE_API_BASE_URL, inlined the
 *    same way by the Android "release" buildType's bundle command (see
 *    android/app/build.gradle + metro.release.config.js). That config file REFUSES to bundle at
 *    all - failing the build itself - unless a real JUPLE_API_BASE_URL was provided, so a release
 *    build can never reach this file with an empty Production URL.
 *
 * Any other combination (should not be reachable given the two build-time gates above) falls
 * through to `undefined` rather than guessing - this must never silently fall back to Local or
 * Dogfood. An unset baseUrl makes apiClient.ts throw ApiError('unavailable') immediately instead
 * of quietly talking to the wrong Backend.
 */

// RN's shared tsconfig deliberately restricts auto-included @types to ["jest"] (see
// @react-native/typescript-config) so the rest of the codebase never sees misleading Node globals
// (Buffer, fs, require, ...) that do not exist in the JS engine at runtime. This declares only the
// shape babel-plugin-transform-inline-environment-variables actually provides, scoped to this
// file alone - no global .d.ts, no broader Node types pulled in.
declare const process: {
  readonly env: {
    readonly JUPLE_API_ENV?: string;
    readonly JUPLE_API_BASE_URL?: string;
  };
};

const localApiBaseUrl = 'http://localhost:5092';
const dogfoodApiBaseUrl =
  'https://ca-juple-api-dev.proudfield-673db2f2.koreacentral.azurecontainerapps.io';

function resolveBaseUrl(): string | undefined {
  if (__DEV__) {
    return localApiBaseUrl;
  }

  if (process.env.JUPLE_API_ENV === 'dogfood') {
    return dogfoodApiBaseUrl;
  }

  if (process.env.JUPLE_API_ENV === 'production') {
    return process.env.JUPLE_API_BASE_URL;
  }

  return undefined;
}

export const apiConfig = {
  baseUrl: resolveBaseUrl(),
};

/**
 * Gates the more verbose share-diagnostics logging (see incomingShareHeadlessTask.ts) to Local
 * Development and Dogfood only - never Production. Production
 * keeps only the privacy-reviewed, always-on failure-classification log (API kind/status/outcome),
 * never this more exploratory diagnostic detail.
 */
export const isDetailedShareDiagnosticsEnabled =
  __DEV__ || process.env.JUPLE_API_ENV === 'dogfood';
