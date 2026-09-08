module.exports = {
  preset: '@react-native/jest-preset',
  // A handful of dependencies ship ESM-only source as their "main" entry point (raw `import`/
  // `export` syntax, no CommonJS build) - see each package's own package.json:
  //   - @react-navigation/* (and its standard-navigation dependency): "exports"."default" points
  //     at lib/module/*.js, no "require" condition at all (react-navigation 7).
  //   - react-native-app-auth (used by src/auth/entraAuthClient.ts) and its own
  //     react-native-base64 dependency: "main" is itself ESM source.
  //   - @react-native-async-storage/async-storage: a *different* npm scope from "@react-native"
  //     itself, so the preset's own "@react-native(-community)?" alternative does not match it -
  //     "main" is also ESM-only here.
  //   - uuid: "type": "module" with no "require" export condition (see src/push's
  //     pushInstallationId.ts, the only place this app imports it).
  //   - react-native-image-picker: "main" points straight at its uncompiled src/index.ts - there
  //     is no build step for this package at all, so it needs the same TypeScript-aware Babel
  //     transform as this app's own source, not just an ESM-to-CJS conversion.
  //   - @react-native-firebase/* (used by src/push): another scope distinct from "@react-native"
  //     itself, "main" is also ESM-only here.
  // Jest's require() hits a bare `import`/`export` statement unless Babel transforms these first.
  // The RN preset's own transformIgnorePatterns only un-ignores react-native/@react-native
  // packages, so this extends that same pattern (rather than replacing it wholesale) to also
  // cover exactly these.
  transformIgnorePatterns: [
    'node_modules/(?!((jest-)?react-native|@react-native(-community)?|@react-native-async-storage|@react-native-firebase|@react-navigation|standard-navigation|react-native-app-auth|react-native-base64|uuid|react-native-image-picker)/)',
  ],
  moduleNameMapper: {
    '^react-native-localize$': 'react-native-localize/mock',
  },
};
