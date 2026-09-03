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

process.env.JUPLE_API_ENV = 'production';

module.exports = require('./metro.config.js');
