// Used only when bundling the Android "release" build variant (see android/app/build.gradle's
// `react { bundleConfig = file("../../metro.release.config.js") }` override for that variant).
//
// There is no Production Backend yet (see src/api/apiConfig.ts). Without this file, a release
// build would still succeed - it would just silently produce an APK whose apiConfig.ts resolves
// to an undefined baseUrl, only failing at runtime on a user's device. Instead, refuse to bundle
// at all until a real Production URL is explicitly provided, so a Production release artifact can
// never be produced by accident.
//
// Provide it via a real OS/Gradle env var once a Production URL exists, e.g.:
//   JUPLE_API_BASE_URL=https://api.example.com ./gradlew assembleRelease
// This env var is read here, in Metro's own Node process at bundle time - it is not the same as
// the process.env reference inside src/api/apiConfig.ts, which only ever sees the literal value
// babel-plugin-transform-inline-environment-variables inlines into the bundle (see below).
const productionApiBaseUrl = process.env.JUPLE_API_BASE_URL;

if (!productionApiBaseUrl) {
  throw new Error(
    'JUPLE_API_BASE_URL is not set. Refusing to build a Production release without an explicit ' +
      'Production API URL (see src/api/apiConfig.ts) - it must never silently fall back to ' +
      'localhost or the Azure Dev Backend. Set JUPLE_API_BASE_URL once a Production URL exists, ' +
      'e.g.: JUPLE_API_BASE_URL=https://api.example.com ./gradlew assembleRelease',
  );
}

// Same fail-fast philosophy as JUPLE_API_BASE_URL above, for the Public Collection Sharing deep
// link host (see AndroidManifest.xml's App Links intent-filter, android/app/build.gradle's
// appLinksHost manifest placeholder, and src/config/publicWebConfig.ts). That manifest placeholder
// defaults to an inert "app-links-host-not-configured.invalid" placeholder for Debug/Dogfood - a
// safe default for local dev and Azure Dev Backend dogfooding where no real Public Web domain
// exists yet - but a Production release must never silently ship with that placeholder, or with
// no host at all. Deliberately does not touch android/app/build.gradle to enforce this: any check
// written directly inside its `release { }` buildType closure runs during Gradle's DSL
// configuration phase for *every* buildType (even when only `assembleDebug`/`assembleDogfood` was
// requested), which would break the very Debug/Dogfood builds this must stay safe for. This file
// only ever executes when the "release" variant's own bundle task actually runs, so it cannot
// affect any other buildType.
const productionPublicWebHost = process.env.JUPLE_PUBLIC_WEB_HOST;
const isValidProductionPublicWebHost =
  typeof productionPublicWebHost === 'string' &&
  productionPublicWebHost.trim().length > 0 &&
  !productionPublicWebHost.includes('://') &&
  !productionPublicWebHost.includes('/') &&
  !productionPublicWebHost.includes(':') &&
  productionPublicWebHost.includes('.') &&
  productionPublicWebHost !== 'localhost' &&
  productionPublicWebHost !== 'app-links-host-not-configured.invalid';

if (!isValidProductionPublicWebHost) {
  throw new Error(
    'JUPLE_PUBLIC_WEB_HOST is not set to a valid bare HTTPS host. Refusing to build a Production ' +
      'release without a real Public Web domain (see AndroidManifest.xml\'s App Links intent-filter ' +
      'and src/navigation/linking.ts) - it must never ship with the ' +
      '"app-links-host-not-configured.invalid" placeholder, localhost, or no host at all. Set ' +
      'JUPLE_PUBLIC_WEB_HOST to a bare host (no scheme/path, e.g. app.example.com) once a real ' +
      'domain exists, e.g.: JUPLE_PUBLIC_WEB_HOST=app.example.com ./gradlew assembleRelease',
  );
}

// Same fail-fast philosophy as JUPLE_API_BASE_URL/JUPLE_PUBLIC_WEB_HOST above, for the Production
// Microsoft Entra External ID values a release build authenticates against (see
// src/auth/entraAuthConfig.ts). None of these exist yet (no Production Entra tenant/app
// registrations - see README.md), and none has a literal default: without this check, a release
// build would still succeed but silently ship still wired to the Development Entra tenant (see
// entraAuthConfig.ts's own resolveEntraAuthConfig(), which would otherwise only fail this loudly at
// app startup on a user's device instead of at build time). This must never fall back to the
// Development tenant, an empty value, or a fabricated Production value.
const productionEntraEnvVarNames = [
  'JUPLE_ENTRA_PROD_INSTANCE',
  'JUPLE_ENTRA_PROD_TENANT_ID',
  'JUPLE_ENTRA_PROD_API_CLIENT_ID',
  'JUPLE_ENTRA_PROD_NATIVE_CLIENT_ID',
];
const missingProductionEntraEnvVarNames = productionEntraEnvVarNames.filter(
  name => !process.env[name],
);

if (missingProductionEntraEnvVarNames.length > 0) {
  throw new Error(
    'Missing required Production Microsoft Entra environment variable(s): ' +
      missingProductionEntraEnvVarNames.join(', ') +
      '. Refusing to build a Production release that would silently authenticate against the ' +
      'Development Entra tenant (see src/auth/entraAuthConfig.ts). Set each once the Production ' +
      'Entra tenant/app registrations exist, alongside JUPLE_API_BASE_URL, e.g.: ' +
      'JUPLE_ENTRA_PROD_INSTANCE=https://<prod-tenant>.ciamlogin.com/ ' +
      'JUPLE_ENTRA_PROD_TENANT_ID=<guid> JUPLE_ENTRA_PROD_API_CLIENT_ID=<guid> ' +
      'JUPLE_ENTRA_PROD_NATIVE_CLIENT_ID=<guid> JUPLE_API_BASE_URL=https://api.example.com ' +
      './gradlew assembleRelease',
  );
}

process.env.JUPLE_API_ENV = 'production';

module.exports = require('./metro.config.js');
