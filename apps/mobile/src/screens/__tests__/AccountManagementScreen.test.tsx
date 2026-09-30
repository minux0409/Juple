import Clipboard from '@react-native-clipboard/clipboard';
import ReactTestRenderer, { act } from 'react-test-renderer';
import { Modal, Text } from 'react-native';
import i18n from '../../i18n';
import { getMyProfile } from '../../api/profileApi';
import { useAuth } from '../../auth/AuthContext';
import { reauthenticateSameAccount } from '../../auth/reauthentication';
import { AccountManagementScreen } from '../AccountManagementScreen';

jest.mock('../../auth/AuthContext', () => ({ useAuth: jest.fn() }));
jest.mock('../../auth/reauthentication', () => ({ reauthenticateSameAccount: jest.fn() }));
jest.mock('../../api/profileApi', () => ({
  ...jest.requireActual('../../api/profileApi'),
  getMyProfile: jest.fn(),
}));

const mockNavigate = jest.fn();
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: mockNavigate }),
  useFocusEffect: (callback: () => void | (() => void)) => {
    const React = require('react');
    React.useEffect(() => callback(), [callback]);
  },
}));
jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: ({ children }: { children: React.ReactNode }) => children,
}));

beforeAll(async () => {
  await i18n.changeLanguage('ko');
});

beforeEach(() => {
  jest.mocked(useAuth).mockReturnValue({ userEmail: 'me@example.com' } as never);
});

afterEach(() => jest.clearAllMocks());

async function renderWith(signInMethod: string | undefined) {
  jest.mocked(getMyProfile).mockResolvedValue({ displayName: null, jupleId: 'K7MP4Q8N', signInMethod });
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => {
    renderer = ReactTestRenderer.create(<AccountManagementScreen />);
  });
  return renderer;
}

const texts = (node: ReactTestRenderer.ReactTestInstance) => node.findAllByType(Text).map(text => text.props.children);
const has = (renderer: ReactTestRenderer.ReactTestRenderer, testID: string) =>
  renderer.root.findAll(node => node.props.testID === testID).length > 0;

describe('AccountManagementScreen', () => {
  it('no longer shows the Juple ID (it lives on 프로필 편집, with its 복사)', async () => {
    const renderer = await renderWith('email');

    expect(has(renderer, 'account-juple-id')).toBe(false);
    expect(has(renderer, 'account-juple-id-copy')).toBe(false);
    expect(JSON.stringify(texts(renderer.root))).not.toContain('K7MP-4Q8N');
    expect(Clipboard.setString).not.toHaveBeenCalled();
  });

  it('an email account shows 이메일 with its address, and offers 비밀번호 재설정 (never "변경")', async () => {
    const renderer = await renderWith('email');

    const method = texts(renderer.root.findByProps({ testID: 'account-sign-in-method' }));
    expect(method).toEqual(expect.arrayContaining([i18n.t('account.methodEmail'), 'me@example.com']));
    const reset = renderer.root.findByProps({ testID: 'account-password-reset' });
    // A plain "비밀번호 재설정 >" row - no description under it.
    expect(texts(reset)).toEqual(['비밀번호 재설정']);
    expect(JSON.stringify(texts(renderer.root))).not.toContain('비밀번호 변경');
  });

  it.each([
    ['google', 'account.methodGoogle', 'account.passwordManagedByGoogle'],
    ['apple', 'account.methodApple', 'account.passwordManagedByApple'],
  ])('a %s account offers no Juple password management', async (method, labelKey, managedKey) => {
    const renderer = await renderWith(method);

    expect(texts(renderer.root.findByProps({ testID: 'account-sign-in-method' }))).toEqual(
      expect.arrayContaining([i18n.t(labelKey), i18n.t(managedKey)]),
    );
    expect(has(renderer, 'account-password-reset')).toBe(false);
    // The email address is not presented as the sign-in method of a Google/Apple account.
    expect(texts(renderer.root)).not.toContain('me@example.com');
  });

  it.each([['unknown'], [undefined], ['facebook']])('an unrecognized method (%s) gets no password action and no guess', async method => {
    const renderer = await renderWith(method);

    expect(texts(renderer.root.findByProps({ testID: 'account-sign-in-method' }))).toContain(i18n.t('account.methodUnknown'));
    expect(has(renderer, 'account-password-reset')).toBe(false);
  });

  const pressPasswordReset = async (renderer: ReactTestRenderer.ReactTestRenderer) => {
    await act(async () => {
      renderer.root.findByProps({ testID: 'account-password-reset' }).props.onPress();
    });
  };

  it('password reset opens the sign-in page at once - no explanation dialog first', async () => {
    jest.mocked(reauthenticateSameAccount).mockResolvedValue('reauthenticated');
    const renderer = await renderWith('email');

    await pressPasswordReset(renderer);

    expect(reauthenticateSameAccount).toHaveBeenCalledTimes(1);
    expect(renderer.root.findAll(node => node.type === Modal && node.props.visible === true)).toHaveLength(0);
    expect(JSON.stringify(texts(renderer.root))).not.toContain('로그인 화면 열기');
  });

  // A finished sign-in can't tell a completed reset from a plain sign-in, so no outcome is announced -
  // neither "changed" nor "signed in again" nor "not completed".
  it.each([
    ['cancelled', () => jest.mocked(reauthenticateSameAccount).mockRejectedValue(new Error('cancelled'))],
    ['closed (browser dismissed)', () => jest.mocked(reauthenticateSameAccount).mockRejectedValue(new Error('dismissed'))],
    ['incomplete', () => jest.mocked(reauthenticateSameAccount).mockResolvedValue('incomplete')],
    ['finished (same account)', () => jest.mocked(reauthenticateSameAccount).mockResolvedValue('reauthenticated')],
  ])('a %s sign-in returns here quietly - no message at all', async (_label, arrange) => {
    arrange();
    const renderer = await renderWith('email');

    await pressPasswordReset(renderer);

    expect(reauthenticateSameAccount).toHaveBeenCalledTimes(1);
    expect(has(renderer, 'account-notice')).toBe(false);
    const shown = JSON.stringify(texts(renderer.root));
    for (const message of ['로그인이 완료되지 않아', '다시 로그인했어요', '비밀번호 변경이 완료']) {
      expect(shown).not.toContain(message);
    }
    expect(renderer.root.findAll(node => node.type === Modal && node.props.visible === true)).toHaveLength(0);
    expect(renderer.root.findByProps({ testID: 'account-password-reset' }).props.disabled).toBe(false);
  });

  it('a different account is not a cancellation: it says the current session was kept', async () => {
    jest.mocked(reauthenticateSameAccount).mockResolvedValue('differentAccount');
    const renderer = await renderWith('email');

    await pressPasswordReset(renderer);

    expect(renderer.root.findByProps({ testID: 'account-notice' }).props.children).toBe(i18n.t('settings.collectionLockDifferentAccount'));
  });

  it('keeps account deletion in its own danger section and only navigates - it never deletes here', async () => {
    const renderer = await renderWith('email');

    const section = renderer.root.findByProps({ testID: 'account-delete-section' });
    expect(texts(section)).toContain(i18n.t('account.deleteSummary'));
    await act(async () => {
      renderer.root.findByProps({ testID: 'account-delete' }).props.onPress();
    });
    expect(mockNavigate).toHaveBeenCalledWith('DeleteAccount');
  });
});
