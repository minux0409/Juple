import ReactTestRenderer, { act } from 'react-test-renderer';
import i18n from '../../i18n';
import { PermissionsScreen } from '../PermissionsScreen';
import { Platform, Text } from 'react-native';
import { getPushPermissionStatus } from '../../push/pushPermission';
import { reportPushSync } from '../../push/pushRegistrationStatus';

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
  it('under a native header (Settings > 권한) the header owns the top: bottom inset only, as before', async () => {
    const renderer = await render(<PermissionsScreen />);

    expect(safeAreaEdges(renderer)).toEqual(['bottom']);
    act(() => renderer.unmount());
  });
});


it('iOS shows the real APNs registration status instead of the unconditional not-ready notice', async () => {
  const originalOS = Platform.OS;
  Object.defineProperty(Platform, 'OS', { configurable: true, value: 'ios' });
  jest.mocked(getPushPermissionStatus).mockResolvedValueOnce('granted');
  reportPushSync('registered');
  try {
    const renderer = await render(<PermissionsScreen />);
    const text = () => renderer.root.findAllByType(Text).map(node => String(node.props.children)).join(' ');
    expect(text()).toContain(i18n.t('permissions.sync.registered'));
    expect(text()).not.toContain(i18n.t('permissions.apnsNotReady'));
    act(() => { reportPushSync('registrationFailed'); });
    expect(text()).toContain(i18n.t('permissions.sync.registrationFailed'));
    act(() => renderer.unmount());
  } finally {
    Object.defineProperty(Platform, 'OS', { configurable: true, value: originalOS });
  }
});
