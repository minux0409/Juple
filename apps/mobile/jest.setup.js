// React Native's Jest mock window is 750dp wide - a SMALL TABLET by the responsive Grid rules (src/layout/responsiveGrid). The
// existing tests describe the phone layout, so every test file starts on a typical phone width; a test that needs a tablet
// calls Dimensions.set({ window: { ... } }) itself (see src/layout/__tests__/tabletGrid.test.tsx). Only the width changes.
const { Dimensions } = require('react-native');

Dimensions.set({ window: { ...Dimensions.get('window'), width: 411 } });

// The kept signed photo URLs (src/images/stableImageUri.ts) are session-scoped module state: every test starts from an empty
// session, exactly as the app does after a sign-out.
// eslint-disable-next-line no-undef -- Jest's own global in a setupFilesAfterEnv file
afterEach(() => { require('./src/images/stableImageUri').clearStableImageUris(); });
