import ReactTestRenderer, { act } from 'react-test-renderer';
import '../../i18n';
import { PermissionsScreen } from '../PermissionsScreen';

// Records the SafeAreaView edges each layout asks for (the real one needs a native provider).
jest.mock('react-native-safe-area-context', () => {
  const { View } = jest.requireActual<typeof import('react-native')>('react-native');
  return { SafeAreaView: (props: Record<string, unknown>) => <View {...props} /> };
});
jest.mock('../../api/useAuthenticatedApi', () => ({ useAuthenticatedApi: () => jest.fn() }));
jest.mock('../../push/pushPermission', () => ({
  getPushPermissionStatus: jest.fn(() => Promise.resolve('notDetermined')),
  requestPushPermission: jest.fn(() => Promise.resolve('notDetermined')),
}));
jest.mock('../../push/pushPermissionRequestState', () => ({
  hasRequestedPushPermission: jest.fn(() => Promise.resolve(false)),
  markPushPermissionRequested: jest.fn(() => Promise.resolve()),
}));
jest.mock('../../push/pushRegistrationSync', () => ({ syncPushRegistration: jest.fn(() => Promise.resolve('registered')) }));

async function render(element: React.ReactElement) {
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => {
    renderer = ReactTestRenderer.create(element);
  });
  return renderer;
}

const safeAreaEdges = (renderer: ReactTestRenderer.ReactTestRenderer) =>
  renderer.root.findAll(node => Array.isArray(node.props.edges) && typeof node.type !== 'string')[0]?.props.edges;

describe('PermissionsScreen safe area', () => {
  it('first-run onboarding (no native header) keeps the title out of the status bar: top and bottom insets', async () => {
    const renderer = await render(<PermissionsScreen onDone={jest.fn()} withoutHeader />);

    expect(safeAreaEdges(renderer)).toEqual(['top', 'bottom']);
    act(() => renderer.unmount());
  });

  it('under a native header (Settings > 권한) the header owns the top: bottom inset only, as before', async () => {
    const renderer = await render(<PermissionsScreen />);

    expect(safeAreaEdges(renderer)).toEqual(['bottom']);
    act(() => renderer.unmount());
  });
});
