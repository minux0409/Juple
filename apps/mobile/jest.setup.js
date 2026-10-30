// React Native's Jest mock window is 750dp wide - a SMALL TABLET by the responsive Grid rules (src/layout/responsiveGrid). The
// existing tests describe the phone layout, so every test file starts on a typical phone width; a test that needs a tablet
// calls Dimensions.set({ window: { ... } }) itself (see src/layout/__tests__/tabletGrid.test.tsx). Only the width changes.
const { Dimensions } = require('react-native');

Dimensions.set({ window: { ...Dimensions.get('window'), width: 411 } });

// React Test Renderer has no automatic cleanup. Track roots at the test driver boundary so every suite releases
// effects, subscriptions and native-list/toast timers, including when an assertion fails before its manual unmount.
// This is deliberately not a Jest spy: restoreAllMocks in an individual case must not disable teardown.
const testRenderer = require('react-test-renderer');
const createRenderer = testRenderer.create;
const renderedRoots = new Set();
testRenderer.create = (...args) => {
  const renderer = createRenderer(...args);
  renderedRoots.add(renderer);
  const unmount = renderer.unmount;
  renderer.unmount = () => {
    renderedRoots.delete(renderer);
    unmount();
  };
  return renderer;
};
// eslint-disable-next-line no-undef -- Jest lifecycle in setupFilesAfterEnv
afterEach(async () => {
  await testRenderer.act(async () => {
    for (const renderer of renderedRoots) renderer.unmount();
    renderedRoots.clear();
  });
});

// The kept signed photo URLs (src/images/stableImageUri.ts) are session-scoped module state: every test starts from an empty
// session, exactly as the app does after a sign-out.
// eslint-disable-next-line no-undef -- Jest's own global in a setupFilesAfterEnv file
afterEach(() => { require('./src/images/stableImageUri').clearStableImageUris(); });

// The app's Pressable (src/components/Pressable.tsx) is React Native's Pressable plus a pressed-state layer. In screen and component
// tests it IS React Native's own, so their trees and queries stay what they were (the wrapper would add a second element carrying
// the same testID / onPress to every button). Its own behaviour is tested against the real file (components/__tests__/Pressable.test.tsx,
// via jest.requireActual).
// eslint-disable-next-line no-undef -- Jest's own global in a setupFilesAfterEnv file
jest.mock('./src/components/Pressable', () => ({ Pressable: require('react-native').Pressable }));
