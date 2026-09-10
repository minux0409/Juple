import ReactTestRenderer, { act } from 'react-test-renderer';
import { Text } from 'react-native';
import i18n from '../../i18n';
import { StartupProgressScreen } from '../StartupProgressScreen';
import { ProgressBar } from '../../components/ProgressBar';
import { useAuth } from '../../auth/AuthContext';
import type { AuthContextValue } from '../../auth/types';

jest.mock('../../auth/AuthContext', () => ({
  useAuth: jest.fn(),
}));

// The react-native-localize jest mock (see jest.config.js) reports "en-US", so i18n would
// otherwise resolve to English by default - pinned to Korean so this file's text assertions are
// deterministic regardless of that mock's default locale.
beforeAll(async () => {
  await i18n.changeLanguage('ko');
});

function mockAuth(overrides: Partial<AuthContextValue>): void {
  jest.mocked(useAuth).mockReturnValue({
    isInitializing: true,
    isSigningIn: false,
    isAuthenticated: false,
    error: null,
    backendAuthStatus: 'notChecked',
    userBootstrapStatus: 'notStarted',
    sessionRestoreStep: 'sessionRestore',
    signIn: jest.fn(),
    signOut: jest.fn(),
    getValidAccessToken: jest.fn(),
    retryBootstrap: jest.fn(),
    userEmail: null,
    ...overrides,
  });
}

async function renderScreen() {
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => {
    renderer = ReactTestRenderer.create(<StartupProgressScreen />);
  });
  return renderer;
}

describe('StartupProgressScreen', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  it('shows exactly one message line - never an accumulating list of every status seen so far', async () => {
    mockAuth({ sessionRestoreStep: 'sessionRestore' });
    const renderer = await renderScreen();

    expect(renderer.root.findAllByType(Text)).toHaveLength(2); // brand + the single progress message
    expect(renderer.root.findByProps({ children: '로그인 정보를 확인하고 있어요' })).toBeTruthy();
  });

  it('advances the message and progress bar as real bootstrap steps are reached', async () => {
    mockAuth({ isAuthenticated: true, backendAuthStatus: 'checking' });
    let renderer = await renderScreen();
    expect(renderer.root.findByProps({ children: 'Juple 서버에 연결하고 있어요' })).toBeTruthy();
    expect(renderer.root.findByType(ProgressBar).props.progress).toBeCloseTo(3 / 5);

    mockAuth({
      isAuthenticated: true,
      backendAuthStatus: 'valid',
      userBootstrapStatus: 'checking',
    });
    renderer = await renderScreen();
    expect(renderer.root.findByProps({ children: '사용자 정보를 불러오고 있어요' })).toBeTruthy();
    expect(renderer.root.findByType(ProgressBar).props.progress).toBeCloseTo(4 / 5);

    mockAuth({
      isAuthenticated: true,
      backendAuthStatus: 'valid',
      userBootstrapStatus: 'ready',
    });
    renderer = await renderScreen();
    expect(renderer.root.findByProps({ children: '준비가 완료되었습니다' })).toBeTruthy();
    expect(renderer.root.findByType(ProgressBar).props.progress).toBe(1);
  });

  it('switches to a plain error/retry view - not the progress bar - once bootstrap has actually failed', async () => {
    mockAuth({ isAuthenticated: true, backendAuthStatus: 'unavailable' });
    const renderer = await renderScreen();

    expect(renderer.root.findAllByType(ProgressBar)).toHaveLength(0);
    expect(renderer.root.findByProps({ children: '서버에 연결할 수 없습니다.' })).toBeTruthy();
    expect(renderer.root.findByProps({ children: '다시 시도' })).toBeTruthy();
  });

  it('never offers retry for a rejection that retrying cannot fix', async () => {
    mockAuth({ isAuthenticated: true, backendAuthStatus: 'unauthorized' });
    const renderer = await renderScreen();

    expect(renderer.root.findAllByProps({ children: '다시 시도' })).toHaveLength(0);
  });
});
