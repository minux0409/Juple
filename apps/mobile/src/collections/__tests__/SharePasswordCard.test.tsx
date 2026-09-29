import ReactTestRenderer, { act } from 'react-test-renderer';
import { AppState, type AppStateStatus, Modal, StyleSheet, Text, TextInput } from 'react-native';
import Clipboard from '@react-native-clipboard/clipboard';
import i18n from '../../i18n';
import { AppToastProvider } from '../../components/AppToast';
import { NotificationToast } from '../../components/NotificationToast';
import { KeyIcon } from '../../icons/KeyIcon';
import { ApiError } from '../../api/ApiError';
import { SharePasswordCard, validateSharePassword } from '../SharePasswordCard';
import {
  getSharePasswordStatus,
  removeSharePassword,
  revealSharePassword,
  setSharePassword,
  type SharePasswordStatus,
} from '../api/sharePasswordApi';
import { unlockCollection } from '../api/collectionsApi';
import { contentGateOf, needsUnlockForContent } from '../collectionAccess';
import { contentGateOfError } from '../useCollectionItems';
import { CollectionStatusBadges } from '../CollectionStatusBadges';
import { clearCollectionUnlockGrants, getCollectionUnlockToken, rememberCollectionUnlock } from '../collectionUnlockGrants';

// Focus: the card reveals on focus and forgets on blur. mockBlurAll() blurs every mounted card.
const mockBlurHandlers: Array<() => void> = [];
function mockBlurAll() {
  mockBlurHandlers.splice(0).forEach(handler => handler());
}
jest.mock('@react-navigation/native', () => ({
  useFocusEffect: (callback: () => void | (() => void)) => {
    const React = require('react');
    React.useEffect(() => {
      const cleanup = callback();
      if (cleanup) {
        mockBlurHandlers.push(cleanup);
      }
      return cleanup;
    }, [callback]);
  },
}));

jest.mock('../api/sharePasswordApi', () => ({
  getSharePasswordStatus: jest.fn(),
  setSharePassword: jest.fn(),
  removeSharePassword: jest.fn(),
  revealSharePassword: jest.fn(),
  unlockSharePassword: jest.fn(),
}));

// The inline lock prompt (CollectionUnlockPanel) asks the server through its own hook.
jest.mock('../../api/useAuthenticatedApi', () => ({ useAuthenticatedApi: () => jest.fn() }));
jest.mock('../api/collectionsApi', () => ({
  ...jest.requireActual('../api/collectionsApi'),
  unlockCollection: jest.fn(),
}));

beforeAll(async () => {
  await i18n.changeLanguage('ko');
});

const mounted: ReactTestRenderer.ReactTestRenderer[] = [];

afterEach(() => {
  // Unmounting also clears the toast's own dismiss timer.
  mounted.splice(0).forEach(renderer => act(() => renderer.unmount()));
  mockBlurHandlers.splice(0);
  jest.clearAllMocks();
  clearCollectionUnlockGrants();
});

const request = jest.fn();
const off: SharePasswordStatus = { mode: 'none', isEnabled: false, updatedAtUtc: null };
const on: SharePasswordStatus = { mode: 'perCollection', isEnabled: true, updatedAtUtc: '2026-09-29T00:00:00Z' };
const legacy: SharePasswordStatus = { mode: 'legacyCommonLock', isEnabled: true, updatedAtUtc: null };
const locked = () => new ApiError('forbidden', 403, 'collectionLocked');

async function renderCard(onModeChange?: (mode: string) => void) {
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => {
    renderer = ReactTestRenderer.create(
      <AppToastProvider>
        <SharePasswordCard authenticatedRequest={request} collectionId={7} onModeChange={onModeChange} />
      </AppToastProvider>,
    );
  });
  mounted.push(renderer);
  return renderer;
}

function unmountNow(renderer: ReactTestRenderer.ReactTestRenderer) {
  act(() => renderer.unmount());
  mounted.splice(mounted.indexOf(renderer), 1);
}

const toastMessages = (renderer: ReactTestRenderer.ReactTestRenderer) =>
  renderer.root.findAllByType(NotificationToast).map(toast => toast.props.message);
const pressable = (renderer: ReactTestRenderer.ReactTestRenderer, testID: string) =>
  renderer.root.find(node => node.props.testID === testID && typeof node.props.onPress === 'function' && node.props.style !== undefined);
const has = (renderer: ReactTestRenderer.ReactTestRenderer, testID: string) =>
  renderer.root.findAll(node => node.props.testID === testID).length > 0;
const allText = (renderer: ReactTestRenderer.ReactTestRenderer) =>
  renderer.root.findAllByType(Text).map(node => String(node.props.children)).join('\n');
const valueText = (renderer: ReactTestRenderer.ReactTestRenderer) =>
  renderer.root.findAll(node => node.props.testID === 'share-password-value' && node.type === Text)[0] ?? null;
const shownPassword = (renderer: ReactTestRenderer.ReactTestRenderer) => valueText(renderer)?.props.children ?? null;

/** The enter-the-password dialog (not the removal confirmation), when open. */
const passwordDialog = (renderer: ReactTestRenderer.ReactTestRenderer) =>
  renderer.root.findAllByType(Modal).find(modal => modal.props.visible && modal.findAll(node => node.props.testID === 'share-password-dialog').length > 0) ?? null;

async function press(renderer: ReactTestRenderer.ReactTestRenderer, testID: string) {
  await act(async () => {
    await pressable(renderer, testID).props.onPress();
  });
}

async function toggle(renderer: ReactTestRenderer.ReactTestRenderer, value: boolean) {
  await act(async () => {
    renderer.root.findByProps({ testID: 'share-password-toggle' }).props.onValueChange(value);
  });
}

async function confirmRemoval(renderer: ReactTestRenderer.ReactTestRenderer) {
  const confirmDialog = renderer.root.findAllByType(Modal).find(modal => modal.props.visible)!;
  expect(confirmDialog.findAllByType(Text).map(node => node.props.children)).toContain(i18n.t('collections.sharePasswordRemoveTitle'));
  await act(async () => {
    confirmDialog.findAll(node => node.props.accessibilityLabel === i18n.t('collections.sharePasswordRemove'))[0].props.onPress();
  });
}

async function typeAndSubmit(renderer: ReactTestRenderer.ReactTestRenderer, password: string) {
  await act(async () => {
    renderer.root.findByProps({ testID: 'share-password-input' }).props.onChangeText(password);
  });
  await press(renderer, 'share-password-submit');
}

describe('SharePasswordCard - the Owner simply sees it', () => {
  it('on: it is revealed right away (owner-only reveal, on entering) and shown in plain text - no 보기/숨기기, no mask', async () => {
    jest.mocked(getSharePasswordStatus).mockResolvedValue(on);
    jest.mocked(revealSharePassword).mockResolvedValue('trip-2026');
    const renderer = await renderCard();

    expect(revealSharePassword).toHaveBeenCalledTimes(1);
    expect(revealSharePassword).toHaveBeenCalledWith(request, 7);
    expect(shownPassword(renderer)).toBe('trip-2026');
    expect(renderer.root.findByProps({ testID: 'share-password-toggle' }).props.value).toBe(true);
    for (const gone of ['share-password-show', 'share-password-hide', 'share-password-masked', 'share-password-remove']) {
      expect(has(renderer, gone)).toBe(false);
    }
    expect(allText(renderer)).not.toContain('••••');
    expect(has(renderer, 'share-password-copy')).toBe(true);
    expect(has(renderer, 'share-password-change')).toBe(true);
  });

  it('off: nothing is revealed - only the status is asked', async () => {
    jest.mocked(getSharePasswordStatus).mockResolvedValue(off);
    const renderer = await renderCard();

    expect(renderer.root.findByProps({ testID: 'share-password-toggle' }).props.value).toBe(false);
    expect(revealSharePassword).not.toHaveBeenCalled();
    expect(has(renderer, 'share-password-enabled')).toBe(false);
  });

  it('leaving the screen forgets it; unmounting leaves nothing behind', async () => {
    jest.mocked(getSharePasswordStatus).mockResolvedValue(on);
    jest.mocked(revealSharePassword).mockResolvedValue('trip-2026');
    const renderer = await renderCard();
    expect(shownPassword(renderer)).toBe('trip-2026');

    await act(async () => {
      mockBlurAll();
    });
    expect(shownPassword(renderer)).toBeNull();
    expect(allText(renderer)).not.toContain('trip-2026');

    unmountNow(renderer);
    expect(() => renderer.root).toThrow();
  });

  it('a reveal that answers only after the screen lost focus never shows the password', async () => {
    jest.mocked(getSharePasswordStatus).mockResolvedValue(on);
    let answer!: (password: string) => void;
    jest.mocked(revealSharePassword).mockImplementation(() => new Promise<string>(resolve => {
      answer = resolve;
    }));
    const renderer = await renderCard();

    await act(async () => {
      mockBlurAll();
    });
    await act(async () => {
      answer('late-2026');
    });

    expect(shownPassword(renderer)).toBeNull();
    expect(allText(renderer)).not.toContain('late-2026');
  });

  it('a locked Collection shows nothing before the Owner\'s lock is entered here - then reveals it', async () => {
    jest.mocked(getSharePasswordStatus).mockResolvedValue(on);
    jest.mocked(revealSharePassword).mockRejectedValueOnce(locked()).mockResolvedValue('trip-2026');
    jest.mocked(unlockCollection).mockResolvedValue({ unlockToken: 'lock-grant', expiresAtUtc: new Date(Date.now() + 15 * 60_000).toISOString() });
    const renderer = await renderCard();

    expect(shownPassword(renderer)).toBeNull();
    expect(allText(renderer)).not.toContain('trip-2026');
    expect(has(renderer, 'share-password-lock-unlock')).toBe(true);
    expect(has(renderer, 'collection-unlock-panel')).toBe(true);
    expect(has(renderer, 'collection-share-password-panel')).toBe(false);

    await act(async () => {
      renderer.root.findByProps({ testID: 'collection-unlock-password' }).props.onChangeText('owner-lock');
    });
    await act(async () => {
      await renderer.root.findByProps({ testID: 'collection-unlock-submit' }).props.onPress();
    });

    // The Owner's lock password went to the lock endpoint (never the share one), its grant is kept
    // for this visit only, and the reveal is asked again - with it.
    expect(unlockCollection).toHaveBeenCalledWith(expect.anything(), 7, 'owner-lock');
    expect(getCollectionUnlockToken(7)).toBe('lock-grant');
    expect(revealSharePassword).toHaveBeenCalledTimes(2);
    expect(shownPassword(renderer)).toBe('trip-2026');
    expect(has(renderer, 'share-password-lock-unlock')).toBe(false);
  });

  it('a lock grant entered here is forgotten when this screen goes away', async () => {
    jest.mocked(getSharePasswordStatus).mockResolvedValue(off);
    const renderer = await renderCard();
    rememberCollectionUnlock(7, 'lock-grant', new Date(Date.now() + 15 * 60_000).toISOString());

    unmountNow(renderer);

    expect(getCollectionUnlockToken(7)).toBeNull();
  });
});

describe('SharePasswordCard - the app leaving the foreground', () => {
  let listeners: Array<(state: AppStateStatus) => void> = [];
  let addListener: jest.SpyInstance;
  let presetImplementation: ((...args: never[]) => unknown) | undefined;

  beforeEach(() => {
    listeners = [];
    addListener = jest.spyOn(AppState, 'addEventListener');
    // The React Native Jest preset already mocks AppState; its own behavior is put back afterwards.
    presetImplementation = addListener.getMockImplementation();
    addListener.mockImplementation(((_type: string, handler: (state: AppStateStatus) => void) => {
      listeners.push(handler);
      return { remove: () => { listeners = listeners.filter(listener => listener !== handler); } };
    }) as never);
  });

  afterEach(() => {
    // Unmount here, while this block's subscriptions still exist.
    mounted.splice(0).forEach(renderer => act(() => renderer.unmount()));
    addListener.mockImplementation((presetImplementation ?? (() => ({ remove: () => undefined }))) as never);
  });

  async function appState(state: AppStateStatus) {
    await act(async () => {
      listeners.forEach(listener => listener(state));
    });
  }

  it('A: while the screen is in view it is revealed and shown', async () => {
    jest.mocked(getSharePasswordStatus).mockResolvedValue(on);
    jest.mocked(revealSharePassword).mockResolvedValue('trip-2026');
    const renderer = await renderCard();

    expect(listeners.length).toBeGreaterThan(0);
    expect(shownPassword(renderer)).toBe('trip-2026');
  });

  it.each(['background', 'inactive'] as const)('B: %s drops it at once', async state => {
    jest.mocked(getSharePasswordStatus).mockResolvedValue(on);
    jest.mocked(revealSharePassword).mockResolvedValue('trip-2026');
    const renderer = await renderCard();

    await appState(state);

    expect(shownPassword(renderer)).toBeNull();
    expect(allText(renderer)).not.toContain('trip-2026');
  });

  it('C: a reveal that answers while the app is in the background never brings it back', async () => {
    jest.mocked(getSharePasswordStatus).mockResolvedValue(on);
    let answer!: (password: string) => void;
    jest.mocked(revealSharePassword).mockImplementation(() => new Promise<string>(resolve => {
      answer = resolve;
    }));
    const renderer = await renderCard();

    await appState('background');
    await act(async () => {
      answer('late-2026');
    });

    expect(shownPassword(renderer)).toBeNull();
    expect(allText(renderer)).not.toContain('late-2026');
  });

  it('D: back in the foreground on this screen, it is revealed again and shown', async () => {
    jest.mocked(getSharePasswordStatus).mockResolvedValue(on);
    jest.mocked(revealSharePassword).mockResolvedValue('trip-2026');
    const renderer = await renderCard();
    await appState('background');
    expect(revealSharePassword).toHaveBeenCalledTimes(1);

    await appState('active');

    expect(revealSharePassword).toHaveBeenCalledTimes(2);
    expect(shownPassword(renderer)).toBe('trip-2026');
    // Another 'active' while already in the foreground asks nothing more.
    await appState('active');
    expect(revealSharePassword).toHaveBeenCalledTimes(2);
  });

  it('E: back in the foreground while this screen is not in view - nothing is asked', async () => {
    jest.mocked(getSharePasswordStatus).mockResolvedValue(on);
    jest.mocked(revealSharePassword).mockResolvedValue('trip-2026');
    const renderer = await renderCard();
    await act(async () => {
      mockBlurAll();
    });
    await appState('background');

    await appState('active');

    expect(revealSharePassword).toHaveBeenCalledTimes(1);
    expect(shownPassword(renderer)).toBeNull();
  });

  it('a password saved while the app went to the background is not held - the return reveals it', async () => {
    jest.mocked(getSharePasswordStatus).mockResolvedValueOnce(off).mockResolvedValue(on);
    let saved!: (status: SharePasswordStatus) => void;
    jest.mocked(setSharePassword).mockImplementation(() => new Promise<SharePasswordStatus>(resolve => {
      saved = resolve;
    }));
    jest.mocked(revealSharePassword).mockResolvedValue('abcd1234');
    const renderer = await renderCard();
    await toggle(renderer, true);
    await act(async () => {
      renderer.root.findByProps({ testID: 'share-password-input' }).props.onChangeText('abcd1234');
    });
    act(() => {
      pressable(renderer, 'share-password-submit').props.onPress();
    });

    await appState('background');
    await act(async () => {
      saved(on);
    });
    expect(shownPassword(renderer)).toBeNull();

    await appState('active');
    expect(shownPassword(renderer)).toBe('abcd1234');
  });
});

describe('SharePasswordCard - 복사', () => {
  it('copies exactly the shown password and says so', async () => {
    jest.mocked(getSharePasswordStatus).mockResolvedValue(on);
    jest.mocked(revealSharePassword).mockResolvedValue('trip-2026');
    const renderer = await renderCard();

    await press(renderer, 'share-password-copy');

    expect(Clipboard.setString).toHaveBeenCalledTimes(1);
    expect(jest.mocked(Clipboard.setString).mock.calls[0][0] === 'trip-2026').toBe(true);
    expect(revealSharePassword).toHaveBeenCalledTimes(1);
    expect(toastMessages(renderer)).toEqual([i18n.t('collections.sharePasswordCopied')]);
    expect(i18n.t('collections.sharePasswordCopied')).toBe('공유 비밀번호를 복사했어요.');
    expect(has(renderer, 'share-password-error')).toBe(false);
  });

  it('a failed copy only says so - no crash, no toast, and the password stays selectable', async () => {
    jest.mocked(getSharePasswordStatus).mockResolvedValue(on);
    jest.mocked(revealSharePassword).mockResolvedValue('trip-2026');
    jest.mocked(Clipboard.setString).mockImplementationOnce(() => {
      throw new Error('clipboard unavailable');
    });
    const renderer = await renderCard();

    await press(renderer, 'share-password-copy');

    expect(renderer.root.findByProps({ testID: 'share-password-error' }).props.children).toBe(i18n.t('collections.sharePasswordCopyFailed'));
    expect(toastMessages(renderer)).toEqual([]);
    expect(valueText(renderer)!.props.selectable).toBe(true);
  });

  it('never writes the password to the log - revealing, copying, or failing to copy', async () => {
    const password = 'secret-trip-2026';
    const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map(method => jest.spyOn(console, method));
    try {
      jest.mocked(getSharePasswordStatus).mockResolvedValue(on);
      jest.mocked(revealSharePassword).mockResolvedValue(password);
      const renderer = await renderCard();
      await press(renderer, 'share-password-copy');
      jest.mocked(Clipboard.setString).mockImplementationOnce(() => {
        throw new Error('clipboard unavailable');
      });
      await press(renderer, 'share-password-copy');

      const logged = spies.flatMap(spy => spy.mock.calls).map(call => call.map(String).join(' '));
      expect(logged.some(line => line.includes(password))).toBe(false);
      expect(toastMessages(renderer).some(message => String(message).includes(password))).toBe(false);
      expect(String(renderer.root.findByProps({ testID: 'share-password-error' }).props.children).includes(password)).toBe(false);
    } finally {
      spies.forEach(spy => spy.mockRestore());
    }
  });
});

describe('SharePasswordCard - on, off and change', () => {
  it('off → on asks for it once, in a plain visible field - no confirmation field - then shows it', async () => {
    jest.mocked(getSharePasswordStatus).mockResolvedValue(off);
    jest.mocked(setSharePassword).mockResolvedValue(on);
    const renderer = await renderCard();

    await toggle(renderer, true);
    const dialog = passwordDialog(renderer)!;
    expect(dialog).not.toBeNull();
    const inputs = dialog.findAllByType(TextInput);
    expect(inputs).toHaveLength(1);
    expect(inputs[0].props.secureTextEntry).toBe(false);
    expect(inputs[0].props.accessibilityLabel).toBe(i18n.t('collections.sharePasswordNewLabel'));
    expect(has(renderer, 'share-password-confirm')).toBe(false);

    await typeAndSubmit(renderer, 'abcd1234');

    expect(setSharePassword).toHaveBeenCalledWith(request, 7, 'abcd1234');
    expect(passwordDialog(renderer)).toBeNull();
    // Shown straight away - exactly what was saved, without asking the server for it back.
    expect(shownPassword(renderer)).toBe('abcd1234');
    expect(revealSharePassword).not.toHaveBeenCalled();
  });

  it('checks the policy before asking the server', async () => {
    jest.mocked(getSharePasswordStatus).mockResolvedValue(off);
    const renderer = await renderCard();
    await toggle(renderer, true);

    await typeAndSubmit(renderer, '123');

    expect(renderer.root.findByProps({ testID: 'share-password-dialog-error' }).props.children)
      .toBe(i18n.t('collections.sharePasswordPolicy', { min: 4, max: 64 }));
    expect(setSharePassword).not.toHaveBeenCalled();
  });

  it('변경 takes the new one once, in one field, and shows it', async () => {
    jest.mocked(getSharePasswordStatus).mockResolvedValue(on);
    jest.mocked(revealSharePassword).mockResolvedValue('old-pass');
    jest.mocked(setSharePassword).mockResolvedValue(on);
    const renderer = await renderCard();

    await press(renderer, 'share-password-change');
    const dialog = passwordDialog(renderer)!;
    expect(dialog.findAllByType(TextInput)).toHaveLength(1);
    expect(dialog.findAllByType(TextInput)[0].props.accessibilityLabel).toBe(i18n.t('collections.sharePasswordChangeLabel'));
    expect(i18n.t('collections.sharePasswordChangeLabel')).toBe('새 공유 비밀번호');
    expect(allText(renderer)).toContain(i18n.t('collections.sharePasswordChangeTitle'));

    await typeAndSubmit(renderer, 'new-pass');

    expect(setSharePassword).toHaveBeenCalledWith(request, 7, 'new-pass');
    expect(shownPassword(renderer)).toBe('new-pass');
  });

  it('on → off is the removal: it asks first, then removes the protection - no separate 보호 해제 button', async () => {
    jest.mocked(getSharePasswordStatus).mockResolvedValue(on);
    jest.mocked(revealSharePassword).mockResolvedValue('trip-2026');
    jest.mocked(removeSharePassword).mockResolvedValue(off);
    const onModeChange = jest.fn();
    const renderer = await renderCard(onModeChange);
    expect(has(renderer, 'share-password-remove')).toBe(false);

    await toggle(renderer, false);
    expect(removeSharePassword).not.toHaveBeenCalled();
    await confirmRemoval(renderer);

    expect(removeSharePassword).toHaveBeenCalledWith(request, 7);
    expect(renderer.root.findByProps({ testID: 'share-password-toggle' }).props.value).toBe(false);
    expect(shownPassword(renderer)).toBeNull();
    expect(onModeChange).toHaveBeenLastCalledWith('none');
  });

  it('cancelling the removal keeps it on', async () => {
    jest.mocked(getSharePasswordStatus).mockResolvedValue(on);
    jest.mocked(revealSharePassword).mockResolvedValue('trip-2026');
    const renderer = await renderCard();

    await toggle(renderer, false);
    const confirmDialog = renderer.root.findAllByType(Modal).find(modal => modal.props.visible)!;
    await act(async () => {
      confirmDialog.findAll(node => node.props.accessibilityLabel === i18n.t('common.cancel'))[0].props.onPress();
    });

    expect(removeSharePassword).not.toHaveBeenCalled();
    expect(shownPassword(renderer)).toBe('trip-2026');
  });

  it('its actions wrap onto more lines on a narrow (360dp) screen instead of overflowing', async () => {
    jest.mocked(getSharePasswordStatus).mockResolvedValue(on);
    jest.mocked(revealSharePassword).mockResolvedValue('a-rather-long-share-password-that-wraps-2026');
    const renderer = await renderCard();
    let actionsRow = pressable(renderer, 'share-password-copy').parent!;
    while (actionsRow.props.style === undefined) {
      actionsRow = actionsRow.parent!;
    }

    expect(StyleSheet.flatten(actionsRow.props.style)).toEqual(expect.objectContaining({ flexDirection: 'row', flexWrap: 'wrap' }));
    for (const testID of ['share-password-copy', 'share-password-change']) {
      const button = pressable(renderer, testID);
      expect(StyleSheet.flatten(button.props.style)).toEqual(expect.objectContaining({ flexBasis: 88, flexGrow: 1, minHeight: 44 }));
      expect(button.findByType(Text).props.numberOfLines).toBe(2);
    }
    // A long password wraps inside its box rather than being cut off (no line limit).
    expect(valueText(renderer)!.props.numberOfLines).toBeUndefined();
  });
});

describe('SharePasswordCard - legacy (the old lock password)', () => {
  it('keeps the notice and 새 공유 비밀번호 설정, shows the switch on, and has no 보호 해제 button', async () => {
    jest.mocked(getSharePasswordStatus).mockResolvedValue(legacy);
    const onModeChange = jest.fn();
    const renderer = await renderCard(onModeChange);

    expect(allText(renderer)).toContain(i18n.t('collections.sharePasswordLegacyNotice'));
    expect(has(renderer, 'share-password-set-new')).toBe(true);
    expect(has(renderer, 'share-password-remove')).toBe(false);
    expect(renderer.root.findByProps({ testID: 'share-password-toggle' }).props.value).toBe(true);
    expect(revealSharePassword).not.toHaveBeenCalled();
    expect(onModeChange).toHaveBeenLastCalledWith('legacyCommonLock');
  });

  it('새 공유 비밀번호 설정 makes it the Collection\'s own (perCollection)', async () => {
    jest.mocked(getSharePasswordStatus).mockResolvedValue(legacy);
    jest.mocked(setSharePassword).mockResolvedValue(on);
    const onModeChange = jest.fn();
    const renderer = await renderCard(onModeChange);

    await press(renderer, 'share-password-set-new');
    expect(passwordDialog(renderer)!.findAllByType(TextInput)).toHaveLength(1);
    await typeAndSubmit(renderer, 'fresh-2026');

    expect(setSharePassword).toHaveBeenCalledWith(request, 7, 'fresh-2026');
    expect(onModeChange).toHaveBeenLastCalledWith('perCollection');
    expect(has(renderer, 'share-password-legacy')).toBe(false);
    expect(shownPassword(renderer)).toBe('fresh-2026');
  });

  it('switching it off asks first, then removes the protection (none)', async () => {
    jest.mocked(getSharePasswordStatus).mockResolvedValue(legacy);
    jest.mocked(removeSharePassword).mockResolvedValue(off);
    const onModeChange = jest.fn();
    const renderer = await renderCard(onModeChange);

    await toggle(renderer, false);
    await confirmRemoval(renderer);

    expect(removeSharePassword).toHaveBeenCalledWith(request, 7);
    expect(onModeChange).toHaveBeenLastCalledWith('none');
    expect(has(renderer, 'share-password-legacy')).toBe(false);
  });
});

describe('which password stands before a Collection', () => {
  it('the Owner only ever faces the lock; a recipient faces the share password (or the lock only in the legacy case)', () => {
    expect(contentGateOf({ accessRole: 'owner', isLocked: true, isSharePasswordProtected: true })).toBe('lock');
    expect(contentGateOf({ accessRole: 'owner', isLocked: false, isSharePasswordProtected: true })).toBeNull();
    expect(contentGateOf({ accessRole: 'viewer', isLocked: false, isSharePasswordProtected: true })).toBe('sharePassword');
    expect(contentGateOf({ accessRole: 'contributor', isLocked: false, isSharePasswordProtected: true })).toBe('sharePassword');
    expect(contentGateOf({ accessRole: 'contributor', isLocked: true, isSharePasswordProtected: false })).toBe('lock');
    expect(contentGateOf({ accessRole: 'viewer', isLocked: false, isSharePasswordProtected: false })).toBeNull();
  });

  it('a stored grant for the visit means nothing more to prove', () => {
    const protectedCollection = { id: 5, accessRole: 'viewer' as const, isLocked: false, isSharePasswordProtected: true };
    expect(needsUnlockForContent(protectedCollection)).toBe(true);
    rememberCollectionUnlock(5, 'grant', new Date(Date.now() + 10 * 60_000).toISOString());
    expect(needsUnlockForContent(protectedCollection)).toBe(false);
  });

  it('tells the two server answers apart', () => {
    expect(contentGateOfError(new ApiError('forbidden', 403, 'sharePasswordRequired'))).toBe('sharePassword');
    expect(contentGateOfError(new ApiError('forbidden', 403, 'collectionLocked'))).toBe('lock');
    expect(contentGateOfError(new ApiError('forbidden', 403, 'collectionForbidden'))).toBeNull();
  });

  it('checks the password policy like the server (NFC, 4-64, no surrounding spaces)', () => {
    const t = i18n.t.bind(i18n);
    expect(validateSharePassword('1234', t)).toBeNull();
    expect(validateSharePassword('café', t)).toBeNull();
    expect(validateSharePassword(' 1234', t)).not.toBeNull();
    expect(validateSharePassword('1234 ', t)).not.toBeNull();
    expect(validateSharePassword('123', t)).not.toBeNull();
    expect(validateSharePassword('a'.repeat(65), t)).not.toBeNull();
    expect(validateSharePassword('12\n34', t)).not.toBeNull();
  });
});

describe('CollectionStatusBadges', () => {
  it('has no share-password (key) badge - the Collection lock and shared markers stay', () => {
    let renderer!: ReactTestRenderer.ReactTestRenderer;
    act(() => {
      renderer = ReactTestRenderer.create(<CollectionStatusBadges isLocked isShared />);
    });

    expect(renderer.root.findAllByType(KeyIcon)).toHaveLength(0);
    expect(renderer.root.findAll(node => node.props.testID === 'collection-badge-share-password')).toHaveLength(0);
    expect(renderer.root.find(node => node.props.testID === 'collection-badge-locked' && typeof node.type === 'string').props.accessibilityLabel)
      .toBe(i18n.t('collections.lockedA11y'));
    expect(renderer.root.findAll(node => node.props.testID === 'collection-badge-shared').length).toBeGreaterThan(0);
    act(() => renderer.unmount());
  });
});
