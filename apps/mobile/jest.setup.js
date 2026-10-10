// React Native's Jest mock window is 750dp wide - a SMALL TABLET by the responsive Grid rules (src/layout/responsiveGrid). The
// existing tests describe the phone layout, so every test file starts on a typical phone width; a test that needs a tablet
// calls Dimensions.set({ window: { ... } }) itself (see src/layout/__tests__/tabletGrid.test.tsx). Only the width changes.
const { Dimensions } = require('react-native');

Dimensions.set({ window: { ...Dimensions.get('window'), width: 411 } });
