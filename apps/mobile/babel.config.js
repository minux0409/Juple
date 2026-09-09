module.exports = {
  presets: ['module:@react-native/babel-preset'],
  // Inlines process.env.JUPLE_API_ENV / JUPLE_API_BASE_URL / JUPLE_PUBLIC_WEB_HOST /
  // JUPLE_ENTRA_PROD_* as compile-time string constants (see src/api/apiConfig.ts,
  // src/config/publicWebConfig.ts, and src/auth/entraAuthConfig.ts) - the only bundle-time signals
  // used to pick Local/Dogfood/Production API + Entra config and the Collection Sharing deep-link
  // host, set by the Android build (see android/app/build.gradle's dogfood/release buildTypes and
  // metro.dogfood.config.js / metro.release.config.js). `include` allowlists exactly these names so
  // unrelated env vars on the build machine/CI are never inlined into the JS bundle. Pure Babel
  // plugin - no native code, no iOS Xcode project changes, no autolinking.
  plugins: [
    [
      'transform-inline-environment-variables',
      {
        include: [
          'JUPLE_API_ENV',
          'JUPLE_API_BASE_URL',
          'JUPLE_PUBLIC_WEB_HOST',
          'JUPLE_ENTRA_PROD_INSTANCE',
          'JUPLE_ENTRA_PROD_TENANT_ID',
          'JUPLE_ENTRA_PROD_API_CLIENT_ID',
          'JUPLE_ENTRA_PROD_NATIVE_CLIENT_ID',
        ],
      },
    ],
  ],
};
