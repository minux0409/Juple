// Used only when bundling the Android "dogfood" build variant (see android/app/build.gradle's
// `react { bundleConfig = file("../../metro.dogfood.config.js") }` override for that variant).
// Metro's bundle command runs as its own Node process per invocation (see
// BundleHermesCTask.getBundleCommand - it has no per-variant env var passthrough of its own), so
// this is the only reliable place to set JUPLE_API_ENV before Babel loads: it must be set before
// any file is transformed, so babel-plugin-transform-inline-environment-variables (see
// babel.config.js) inlines it into src/api/apiConfig.ts as a real value rather than undefined.
process.env.JUPLE_API_ENV = 'dogfood';

// Same fail-fast philosophy as metro.release.config.js's own JUPLE_PUBLIC_WEB_HOST check, applied
// to Dogfood instead of Production. Without this, a Dogfood build with no (or a malformed)
// JUPLE_PUBLIC_WEB_HOST would still succeed - android/app/build.gradle's `appLinksHost` manifest
// placeholder silently falls back to "app-links-host-not-configured.invalid" for every buildType
// (it lives in `defaultConfig`, not `dogfood { }`, so it can't distinguish buildTypes itself - see
// that file's own comment on why the check has to live here instead), and this file would inline
// that same missing value into the bundled JS's publicWebConfig.ts. The resulting APK would install
// and run fine - Public Collection Sharing App Links would just silently never open the app, only
// discoverable by manually testing a shared link on-device (see docs/architecture.md's Dogfood
// section). Refuse to bundle at all instead, so a Dogfood artifact can never ship with that
// placeholder by accident.
//
// Provide it via a real OS/Gradle env var when dogfooding, e.g.:
//   JUPLE_PUBLIC_WEB_HOST=dev.juple.co.kr ./gradlew assembleDogfood
const dogfoodPublicWebHost = process.env.JUPLE_PUBLIC_WEB_HOST;
const isValidDogfoodPublicWebHost =
  typeof dogfoodPublicWebHost === 'string' &&
  dogfoodPublicWebHost.trim().length > 0 &&
  !dogfoodPublicWebHost.includes('://') &&
  !dogfoodPublicWebHost.includes('/') &&
  !dogfoodPublicWebHost.includes(':') &&
  dogfoodPublicWebHost.includes('.') &&
  dogfoodPublicWebHost !== 'localhost' &&
  dogfoodPublicWebHost !== 'app-links-host-not-configured.invalid';

if (!isValidDogfoodPublicWebHost) {
  throw new Error(
    'JUPLE_PUBLIC_WEB_HOST is not set to a valid bare HTTPS host. Refusing to build a Dogfood ' +
      'artifact without a real Public Web domain (see AndroidManifest.xml\'s App Links intent-filter ' +
      'and src/navigation/linking.ts) - it must never ship with the ' +
      '"app-links-host-not-configured.invalid" placeholder, localhost, or no host at all. Set ' +
      'JUPLE_PUBLIC_WEB_HOST to a bare host (no scheme/path, e.g. dev.juple.co.kr) before ' +
      'dogfooding, e.g.: JUPLE_PUBLIC_WEB_HOST=dev.juple.co.kr ./gradlew assembleDogfood',
  );
}

module.exports = require('./metro.config.js');
