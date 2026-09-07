const path = require('path');
const { getDefaultConfig, mergeConfig } = require('@react-native/metro-config');

/**
 * Metro configuration
 * https://reactnative.dev/docs/metro
 *
 * @type {import('@react-native/metro-config').MetroConfig}
 */
const config = {
  resolver: {
    extraNodeModules: {
      // uuid (a Push InstallationId dependency - see src/push/pushInstallationId.ts) has no
      // "main"/"module" field, only a package.json "exports" map, whose default (non-"node")
      // condition points at its ESM build (dist/index.js) - Metro's resolver, without
      // unstable_enablePackageExports, cannot follow "exports" at all and fails outright
      // ("Unable to resolve module ./parse.js..."). Enabling unstable_enablePackageExports
      // globally instead resolved uuid but made Metro hang indefinitely once
      // @react-native-firebase/app and /messaging (whose own nested "exports" maps are far more
      // complex) were added - confirmed by reproducing the hang with only that flag toggled.
      // Redirecting straight to uuid's CJS build here is a one-package alias, not a resolver-wide
      // behavior change, so it fixes exactly the original problem without touching how Metro
      // resolves anything else - Firebase included.
      uuid: path.resolve(__dirname, 'node_modules/uuid/dist-node'),
    },
  },
};

module.exports = mergeConfig(getDefaultConfig(__dirname), config);
