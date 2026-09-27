import ReactTestRenderer, { act } from 'react-test-renderer';
import { Text, TextInput } from 'react-native';
import i18n from '../../i18n';
import { ApiError } from '../../api/ApiError';
import { CollectionLockSettingsScreen } from '../CollectionLockSettingsScreen';
import {
  changeCollectionLockPassword,
  getCollectionLockPasswordStatus,
  resetCollectionLockPassword,
} from '../../collections/api/collectionLockPasswordApi';
import { reauthenticateSameAccount } from '../../auth/reauthentication';
import { clearCollectionUnlockGrants } from '../../collections/collectionUnlockGrants';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { CollectionLockPasswordDialog } from '../../settings/CollectionLockPasswordDialog';

jest.mock('@react-navigation/native', () => ({
  useFocusEffect: (callback: () => void | (() => void)) => {
    const React = require('react');
    React.useEffect(() => callback(), [callback]);
  },
}));

jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: ({ children }: { children: React.ReactNode }) => children,
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));

jest.mock('../../collections/api/collectionLockPasswordApi', () => ({
  getCollectionLockPasswordStatus: jest.fn(),
  changeCollectionLockPassword: jest.fn().mockResolvedValue(undefined),
  resetCollectionLockPassword: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../../auth/reauthentication', () => ({ reauthenticateSameAccount: jest.fn() }));
jest.mock('../../collections/collectionUnlockGrants', () => ({ clearCollectionUnlockGrants: jest.fn() }));

type Renderer = ReactTestRenderer.ReactTestRenderer;
const exists = (renderer: Renderer, testID: string) => renderer.root.findAll(node => node.props.testID === testID).length > 0;
const texts = (renderer: Renderer) => renderer.root.findAllByType(Text).map(node => String(node.props.children));
const press = async (renderer: Renderer, testID: string) => {
  await act(async () => {
    await renderer.root.findByProps({ testID }).props.onPress();
  });
};
const confirmSignIn = async (renderer: Renderer) => {
  await act(async () => {
    await renderer.root.findByType(ConfirmDialog).props.onConfirm();
  });
};
const type = async (renderer: Renderer, values: Record<string, string>) => {
  await act(async () => {
    Object.entries(values).forEach(([testID, value]) => renderer.root.findByProps({ testID }).props.onChangeText(value));
  });
};
const passwordFields = (renderer: Renderer) => renderer.root.findAllByType(TextInput).map(node => node.props.testID);

const notConfigured = { isConfigured: false, passwordChangedAtUtc: null };
const configured = { isConfigured: true, passwordChangedAtUtc: '2026-09-27T00:00:00Z' };

beforeAll(async () => {
  await i18n.changeLanguage('ko');
});

beforeEach(() => {
  jest.mocked(getCollectionLockPasswordStatus).mockResolvedValue(configured);
  jest.mocked(reauthenticateSameAccount).mockResolvedValue('reauthenticated');
});

afterEach(() => {
  jest.clearAllMocks();
});

async function renderScreen() {
  let renderer!: Renderer;
  await act(async () => {
    renderer = ReactTestRenderer.create(<CollectionLockSettingsScreen />);
  });
  return renderer;
}

describe('CollectionLockSettingsScreen (설정 > 컬렉션 잠금)', () => {
  it('not set: one description, status 설정 안 됨, and only 잠금 비밀번호 설정', async () => {
    jest.mocked(getCollectionLockPasswordStatus).mockResolvedValue(notConfigured);
    const renderer = await renderScreen();

    expect(texts(renderer).filter(text => text === i18n.t('settings.collectionLockDescription'))).toHaveLength(1);
    expect(texts(renderer)).toContain(i18n.t('settings.collectionLockNotConfigured'));
    expect(exists(renderer, 'lock-settings-setup')).toBe(true);
    expect(exists(renderer, 'lock-settings-change')).toBe(false);
    expect(exists(renderer, 'lock-settings-forgot')).toBe(false);
  });

  it('set: status 설정됨, 잠금 비밀번호 변경 and 비밀번호를 잊으셨나요? - and nothing else', async () => {
    const renderer = await renderScreen();

    expect(texts(renderer)).toEqual(
      expect.arrayContaining([
        i18n.t('settings.collectionLockConfigured'),
        i18n.t('settings.collectionLockChangePassword'),
        i18n.t('settings.collectionLockForgot'),
      ]),
    );
    expect(exists(renderer, 'lock-settings-setup')).toBe(false);
  });

  it('never lists Collections, never shows or reveals a password, never mentions device storage', async () => {
    const renderer = await renderScreen();

    expect(renderer.root.findAll(node => /reveal|forget|remember|lock-settings-\d/i.test(String(node.props.testID ?? '')))).toHaveLength(0);
    expect(texts(renderer).some(text => /기기|보기|저장됨/.test(text))).toBe(false);
    expect(passwordFields(renderer)).toEqual([]);
  });

  it('변경: current + new + confirm, verified by the server; afterwards local unlock grants are dropped', async () => {
    const renderer = await renderScreen();

    await press(renderer, 'lock-settings-change');
    expect(renderer.root.findByType(CollectionLockPasswordDialog).props).toEqual(expect.objectContaining({ visible: true, mode: 'change' }));
    expect(passwordFields(renderer)).toEqual(['lock-password-current', 'lock-password-new', 'lock-password-confirm']);
    expect(reauthenticateSameAccount).not.toHaveBeenCalled();

    await type(renderer, { 'lock-password-current': 'old-pass-1', 'lock-password-new': 'new-pass-1', 'lock-password-confirm': 'new-pass-1' });
    await press(renderer, 'lock-password-save');

    expect(changeCollectionLockPassword).toHaveBeenCalledWith(expect.anything(), 'old-pass-1', 'new-pass-1', 'new-pass-1');
    expect(clearCollectionUnlockGrants).toHaveBeenCalled();
    expect(renderer.root.findByProps({ testID: 'lock-settings-notice' }).props.children).toBe(i18n.t('settings.collectionLockSaved'));
  });

  it('a wrong current password stays in the dialog', async () => {
    jest.mocked(changeCollectionLockPassword).mockRejectedValueOnce(new ApiError('forbidden', 403, 'invalidCollectionPassword'));
    const renderer = await renderScreen();
    await press(renderer, 'lock-settings-change');
    await type(renderer, { 'lock-password-current': 'wrong-1', 'lock-password-new': 'new-pass-1', 'lock-password-confirm': 'new-pass-1' });

    await press(renderer, 'lock-password-save');

    expect(renderer.root.findByProps({ testID: 'lock-password-error' }).props.children).toBe(i18n.t('collections.lockWrongCurrentPassword'));
    expect(clearCollectionUnlockGrants).not.toHaveBeenCalled();
  });

  it('비밀번호를 잊으셨나요?: explains the sign-in, signs in again, then asks only for the new password twice', async () => {
    const renderer = await renderScreen();

    await press(renderer, 'lock-settings-forgot');
    const prompt = renderer.root.findByType(ConfirmDialog).props;
    expect(prompt.visible).toBe(true);
    expect(prompt.message).toBe(i18n.t('settings.collectionLockSignInToReset'));
    expect(prompt.confirmLabel).toBe(i18n.t('settings.collectionLockContinue'));
    expect(reauthenticateSameAccount).not.toHaveBeenCalled();

    await confirmSignIn(renderer);
    expect(reauthenticateSameAccount).toHaveBeenCalledTimes(1);
    expect(passwordFields(renderer)).toEqual(['lock-password-new', 'lock-password-confirm']);

    await type(renderer, { 'lock-password-new': 'brand-new-1', 'lock-password-confirm': 'brand-new-1' });
    await press(renderer, 'lock-password-save');

    expect(resetCollectionLockPassword).toHaveBeenCalledWith(expect.anything(), 'brand-new-1', 'brand-new-1');
    expect(clearCollectionUnlockGrants).toHaveBeenCalled();
  });

  it('first setup also starts with signing in again', async () => {
    jest.mocked(getCollectionLockPasswordStatus).mockResolvedValue(notConfigured);
    const renderer = await renderScreen();

    await press(renderer, 'lock-settings-setup');
    expect(renderer.root.findByType(ConfirmDialog).props.message).toBe(i18n.t('settings.collectionLockSignInToConfirm'));
    await confirmSignIn(renderer);

    expect(reauthenticateSameAccount).toHaveBeenCalledTimes(1);
    expect(renderer.root.findByType(CollectionLockPasswordDialog).props).toEqual(expect.objectContaining({ visible: true, mode: 'new' }));
  });

  it.each([
    ['a cancelled or failed sign-in', () => jest.mocked(reauthenticateSameAccount).mockRejectedValueOnce(new Error('cancelled')), 'settings.collectionLockSignInCancelled'],
    ['a different account', () => jest.mocked(reauthenticateSameAccount).mockResolvedValueOnce('differentAccount'), 'settings.collectionLockDifferentAccount'],
    ['an incomplete sign-in', () => jest.mocked(reauthenticateSameAccount).mockResolvedValueOnce('incomplete'), 'settings.collectionLockSignInCancelled'],
  ])('%s: no password dialog, nothing reset', async (_label, arrange, message) => {
    arrange();
    const renderer = await renderScreen();

    await press(renderer, 'lock-settings-forgot');
    await confirmSignIn(renderer);

    expect(renderer.root.findByType(CollectionLockPasswordDialog).props.visible).toBe(false);
    expect(resetCollectionLockPassword).not.toHaveBeenCalled();
    expect(renderer.root.findByProps({ testID: 'lock-settings-notice' }).props.children).toBe(i18n.t(message));
  });

  it('when the server says the sign-in is no longer recent, it asks to sign in again', async () => {
    jest.mocked(resetCollectionLockPassword).mockRejectedValueOnce(new ApiError('forbidden', 403, 'recentAuthenticationRequired'));
    const renderer = await renderScreen();
    await press(renderer, 'lock-settings-forgot');
    await confirmSignIn(renderer);
    await type(renderer, { 'lock-password-new': 'brand-new-1', 'lock-password-confirm': 'brand-new-1' });

    await press(renderer, 'lock-password-save');

    expect(renderer.root.findByType(CollectionLockPasswordDialog).props.visible).toBe(false);
    expect(renderer.root.findByProps({ testID: 'lock-settings-notice' }).props.children).toBe(i18n.t('settings.collectionLockSignInExpired'));
    expect(clearCollectionUnlockGrants).not.toHaveBeenCalled();
  });

  it('checks the new password locally before sending anything', async () => {
    const renderer = await renderScreen();
    await press(renderer, 'lock-settings-forgot');
    await confirmSignIn(renderer);

    await type(renderer, { 'lock-password-new': 'short', 'lock-password-confirm': 'short' });
    await press(renderer, 'lock-password-save');
    expect(renderer.root.findByProps({ testID: 'lock-password-error' }).props.children).toBe(i18n.t('collections.lockPasswordRule', { min: 6 }));

    await type(renderer, { 'lock-password-new': 'long-enough-1', 'lock-password-confirm': 'long-enough-2' });
    await press(renderer, 'lock-password-save');
    expect(renderer.root.findByProps({ testID: 'lock-password-error' }).props.children).toBe(i18n.t('collections.lockPasswordMismatch'));
    expect(resetCollectionLockPassword).not.toHaveBeenCalled();
  });
});
