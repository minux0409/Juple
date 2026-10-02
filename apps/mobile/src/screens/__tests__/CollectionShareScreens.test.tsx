import ReactTestRenderer, { act } from 'react-test-renderer';
import { Modal, StyleSheet, Switch, Text } from 'react-native';
import i18n from '../../i18n';
import { ApiError } from '../../api/ApiError';
import { KeyboardAvoidingView } from 'react-native';
import { CollectionShareScreen, INVITE_CONCURRENCY } from '../CollectionShareScreen';
import { emitSocialPushEvent } from '../../push/pushEvents';
import {
  changeCollaboratorRole,
  changeInvitationRole,
  getCollectionParticipants,
  inviteCollaborator,
  lookupJupleId,
  removeCollaborator,
  revokeCollectionInvitation,
  type CollectionParticipants,
} from '../../collections/api/collaborationApi';
import { CrownIcon } from '../../icons/CrownIcon';
import { UserAvatar } from '../../components/UserAvatar';
import { ViewModeToggle } from '../../components/ViewModeToggle';
import { ActionMenuDialog } from '../../components/ActionMenuDialog';
import { AppToastProvider } from '../../components/AppToast';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { colors, radii } from '../../theme/tokens';
import { shareItem } from '../../items/shareItem';
import { getFriends, type Friend } from '../../friends/api/friendsApi';
import {
  enableCollectionShare,
  revokeCollectionShare,
  getCollection,
  getCollectionShare,
  setCollectionSharePermission,
  type Collection,
} from '../../collections/api/collectionsApi';
import { getSharePasswordStatus, removeSharePassword, setSharePassword } from '../../collections/api/sharePasswordApi';

beforeAll(async () => {
  await i18n.changeLanguage('ko');
});

jest.mock('../../push/pushPermissionFlow', () => ({ ensurePushPermissionOnce: jest.fn() }));
const mockPrefs = new Map<string, string>();
beforeEach(() => mockPrefs.clear());
jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(async (key: string) => mockPrefs.get(key) ?? null),
    setItem: jest.fn(async (key: string, value: string) => {
      mockPrefs.set(key, value);
    }),
  },
}));

// The window the screen lays its person rows out for - a narrow phone unless a test says otherwise.
const mockWindow = { current: { width: 360, height: 800, scale: 2, fontScale: 1 } };
jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true,
  default: () => mockWindow.current,
}));
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

jest.mock('../../items/shareItem', () => ({ shareItem: jest.fn().mockResolvedValue(undefined) }));
jest.mock('../../friends/api/friendsApi', () => ({
  ...jest.requireActual('../../friends/api/friendsApi'),
  getFriends: jest.fn(),
}));

jest.mock('../../collections/api/collaborationApi', () => ({
  ...jest.requireActual('../../collections/api/collaborationApi'),
  getCollectionParticipants: jest.fn(),
  lookupJupleId: jest.fn(),
  inviteCollaborator: jest.fn(),
  revokeCollectionInvitation: jest.fn(),
  removeCollaborator: jest.fn(),
  changeCollaboratorRole: jest.fn(),
  changeInvitationRole: jest.fn(),
}));

// The 공유 비밀번호 card on this screen: off unless a test says otherwise.
jest.mock('../../collections/api/sharePasswordApi', () => ({
  getSharePasswordStatus: jest.fn().mockResolvedValue({ mode: 'none', isEnabled: false, updatedAtUtc: null }),
  setSharePassword: jest.fn(),
  removeSharePassword: jest.fn(),
  revealSharePassword: jest.fn(),
  unlockSharePassword: jest.fn(),
}));

jest.mock('../../collections/api/collectionsApi', () => ({
  ...jest.requireActual('../../collections/api/collectionsApi'),
  getCollection: jest.fn(),
  getCollectionShare: jest.fn(),
  enableCollectionShare: jest.fn(),
  revokeCollectionShare: jest.fn(),
  setCollectionSharePermission: jest.fn(),
}));

type Renderer = ReactTestRenderer.ReactTestRenderer;

const texts = (node: Renderer | ReactTestRenderer.ReactTestInstance) =>
  ('root' in node ? node.root : node).findAllByType(Text).map(text => String(text.props.children));
const byId = (renderer: Renderer, testID: string) => renderer.root.findByProps({ testID });
/** The public link's switch (in its card header): a Pressable around a touch-less visual Switch, no words. */
const publicToggle = (renderer: Renderer) =>
  renderer.root.findAll(node => node.props.testID === 'share-public-toggle' && typeof node.props.onPress === 'function')[0];
const isPublicOn = (renderer: Renderer) => publicToggle(renderer).props.accessibilityState.checked === true;
/** What the visual Switch itself shows - never anything but the actual state. */
const shownSwitchValue = (renderer: Renderer) => publicToggle(renderer).findByType(Switch).props.value;
async function turnPublic(renderer: Renderer, value: boolean) {
  if (isPublicOn(renderer) !== value) {
    await act(async () => {
      await publicToggle(renderer).props.onPress();
    });
  }
}
const raisePrompt = (renderer: Renderer) =>
  renderer.root.findAll(node => node.type === ConfirmDialog && node.props.visible === true && node.props.title === i18n.t('shareSheet.raiseRolesTitle'))[0];
const exists = (renderer: Renderer, testID: string) => renderer.root.findAll(node => node.props.testID === testID).length > 0;

const collection: Collection = {
  id: 5,
  name: 'Trip',
  isFavorite: false,
  itemCount: 2,
  createdAtUtc: '2026-01-01T00:00:00Z',
  updatedAtUtc: '2026-01-01T00:00:00Z',
  icon: 'Folder',
  color: null,
  accessRole: 'owner',
};

const owner = { jupleId: 'WNER2345', displayName: '쥬플리', role: 'owner', isMe: true } as const;

const soloOwner: CollectionParticipants = { participants: [owner], pendingInvitations: [], canManage: true };

const pending = (invitationId: number, jupleId: string, role: 'Viewer' | 'Contributor', displayName: string | null = null) => ({
  invitationId, jupleId, displayName, role, createdAtUtc: '2026-01-01T00:00:00Z', expiresAtUtc: '2026-01-15T00:00:00Z',
});

const readersOnly: CollectionParticipants = {
  participants: [owner, { jupleId: 'RDER2345', displayName: '피카츄', role: 'viewer' }],
  pendingInvitations: [pending(8, 'PNDRD234', 'Viewer', '꼬부기')],
  canManage: true,
};

const withWriter: CollectionParticipants = {
  participants: [owner, { jupleId: 'RDER2345', displayName: '피카츄', role: 'viewer' }, { jupleId: 'WRTR2345', displayName: '파이리', role: 'contributor' }],
  pendingInvitations: [pending(9, 'PNDWR234', 'Contributor', '이상해씨')],
  canManage: true,
};

const friend = (jupleId: string, displayName: string | null, myNote: string | null = null): Friend => ({
  friendshipId: jupleId.charCodeAt(0) + jupleId.charCodeAt(1), jupleId, displayName, myNote, friendsSinceUtc: '',
});

describe('CollectionShareScreen (Owner) - one screen: who and what they may do', () => {
  const route = { key: 'CollectionShare', name: 'CollectionShare', params: { collectionId: 5 } } as never;

  async function renderScreen() {
    let renderer!: Renderer;
    await act(async () => {
      renderer = ReactTestRenderer.create(
        <AppToastProvider>
          <CollectionShareScreen navigation={{} as never} route={route} />
        </AppToastProvider>,
      );
    });
    return renderer;
  }

  async function press(renderer: Renderer, testID: string) {
    await act(async () => {
      await byId(renderer, testID).props.onPress();
    });
  }

  /** The ID tab of 친구 초대 (친구 is the default tab). */
  async function openIdTab(renderer: Renderer) {
    if (!exists(renderer, 'id-invite-input')) {
      await press(renderer, 'share-invite-tabs-id');
    }
  }

  async function findById(renderer: Renderer, value: string) {
    await openIdTab(renderer);
    await act(async () => {
      byId(renderer, 'id-invite-input').props.onChangeText(value);
    });
    await press(renderer, 'id-invite-find');
  }

  async function pickFriends(renderer: Renderer, jupleIds: readonly string[]) {
    await press(renderer, 'invite-choose-friends');
    await act(async () => {
      await new Promise<void>(resolve => setTimeout(resolve, 0));
    });
    await act(async () => {
      jupleIds.forEach(jupleId => byId(renderer, `friend-picker-${jupleId}`).props.onPress());
    });
    await press(renderer, 'friend-picker-confirm');
  }

  beforeEach(() => {
    jest.mocked(getFriends).mockResolvedValue({ items: [], nextCursor: null });
    jest.mocked(getCollection).mockResolvedValue(collection);
    jest.mocked(getCollectionShare).mockResolvedValue(null);
    jest.mocked(getCollectionParticipants).mockResolvedValue(soloOwner);
    jest.mocked(lookupJupleId).mockImplementation(async (_request, jupleId) => ({
      jupleId: jupleId.replace('-', '').toUpperCase(),
      isSelf: jupleId.replace('-', '').toUpperCase() === 'WNER2345',
      displayName: jupleId.startsWith('NAMD') ? '이상해씨' : null,
    }));
    jest.mocked(inviteCollaborator).mockImplementation(async (_request, _id, jupleId, role) => ({
      invitationId: 1, jupleId, role: role === 'viewer' ? 'Viewer' : 'Contributor', createdAtUtc: '', expiresAtUtc: '',
    }));
    jest.mocked(changeCollaboratorRole).mockResolvedValue(undefined);
    jest.mocked(changeInvitationRole).mockResolvedValue(undefined);
  });

  afterEach(() => {
    jest.clearAllMocks();
    mockWindow.current = { width: 360, height: 800, scale: 2, fontScale: 1 };
  });

  it('is independent cards - 컬렉션 공개, 친구 초대, 접근 비밀번호, 공유 상태 - never tabs to choose between, and opening it creates nothing', async () => {
    jest.mocked(getCollectionParticipants).mockResolvedValue(withWriter);
    const renderer = await renderScreen();

    // Both ways of sharing are always shown, each in its own card, in this order.
    const cards = renderer.root
      .findAll(node => typeof node.type === 'string' && ['share-all-users', 'share-invite', 'share-password-card', 'share-status'].includes(node.props.testID))
      .map(node => node.props.testID);
    expect(cards).toEqual(['share-all-users', 'share-invite', 'share-password-card', 'share-status']);
    expect(exists(renderer, 'share-main-tabs')).toBe(false);
    expect(exists(renderer, 'share-ways-section')).toBe(false);
    const headers = renderer.root.findAll(node => node.type === Text && node.props.accessibilityRole === 'header').map(node => node.props.children);
    expect(headers).toEqual(['컬렉션 공개', '친구 초대', '접근 비밀번호', '공유 상태']);
    expect(i18n.t('shareSheet.allUsersTitle')).toBe('컬렉션 공개');
    expect(texts(renderer)).not.toContain('공개 링크 공유');
    expect(i18n.t('shareSheet.inviteTitle')).toBe('친구 초대');
    // No public link yet: the switch is off, shows no OFF / ON words, and there is nothing to share.
    expect(publicToggle(renderer).props.accessibilityLabel).toBe('컬렉션 공개');
    expect(publicToggle(renderer).props.accessibilityRole).toBe('switch');
    expect(texts(renderer)).not.toContain('OFF');
    expect(texts(renderer)).not.toContain('ON');
    expect(isPublicOn(renderer)).toBe(false);
    expect(exists(renderer, 'share-link-action')).toBe(false);
    // OFF: the switch is the only thing at the card header's end - no reserved, empty share-icon slot.
    const offRows = renderer.root.findAll(node => typeof node.type === 'string' && StyleSheet.flatten(node.props.style)?.flexDirection === 'row'
      && StyleSheet.flatten(node.props.style)?.flexShrink === 0 && node.findAll(inner => inner.props.testID === 'share-public-toggle').length > 0);
    const offTrailing = offRows[offRows.length - 1];
    expect(offTrailing.children).toHaveLength(1);
    // Only the in-card tab bars remain; no 일반 공유 / 공동작업 split and none of the old wording.
    const tabs = renderer.root.findAll(node => typeof node.type === 'string' && node.props.accessibilityRole === 'tab');
    expect(tabs.map(tab => tab.props.testID)).toEqual([
      'share-invite-tabs-friends', 'share-invite-tabs-id', 'share-status-tabs-members', 'share-status-tabs-pending',
    ]);
    // 친구 | ID stays a choice inside the invite card.
    expect(byId(renderer, 'share-invite').findAll(node => node.props.testID === 'share-invite-tabs').length).toBeGreaterThan(0);
    expect(byId(renderer, 'share-invite-tabs-friends').props.accessibilityState.selected).toBe(true);
    expect(byId(renderer, 'share-status-tabs-members').props.accessibilityState.selected).toBe(true);
    expect(texts(byId(renderer, 'share-status-tabs-members'))).toEqual([i18n.t('shareSheet.statusTabMembers', { count: 3 })]);
    expect(texts(byId(renderer, 'share-status-tabs-pending'))).toEqual([i18n.t('shareSheet.statusTabPending', { count: 1 })]);
    // 초대 대기 is not spread out until its tab is chosen.
    expect(exists(renderer, 'pending-9')).toBe(false);
    expect(exists(renderer, 'id-invite-input')).toBe(false);
    expect(texts(renderer).some(text => /일반 공유|공동작업|Viewer|Contributor/.test(text))).toBe(false);
    expect(enableCollectionShare).not.toHaveBeenCalled();
  });

  describe('모든 사용자 (the public link: 읽기 or 작성)', () => {
    it('the switch turns it on as 읽기 전용 ([switch][공유 icon] in the header, no ON/OFF text, no URL shown), and off only after confirming', async () => {
      jest.mocked(enableCollectionShare).mockResolvedValue({ publicId: 'p', shareUrl: 'https://juple.test/c/p', createdAtUtc: '', permission: 'read' });
      jest.mocked(revokeCollectionShare).mockResolvedValue(undefined);
      const renderer = await renderScreen();
      // Off at first: no link, no 공유 중, and no separate 공유 시작 / 공유 중지 buttons any more.
      expect(isPublicOn(renderer)).toBe(false);
      expect(publicToggle(renderer).props.accessibilityLabel).toBe('컬렉션 공개');
    expect(publicToggle(renderer).props.accessibilityRole).toBe('switch');
      // The switch alone is the control - no OFF / ON words anywhere.
      expect(texts(renderer)).not.toContain('OFF');
      expect(texts(renderer)).not.toContain('ON');
      expect(exists(renderer, 'share-public-state')).toBe(false);
      // Off: no share action either - there is nothing to share yet.
      for (const gone of ['share-create-link', 'share-stop', 'share-all-users-status', 'share-link', 'share-link-row', 'share-link-action']) {
        expect(exists(renderer, gone)).toBe(false);
      }

      expect(byId(renderer, 'share-all-users-permission-read').props.accessibilityState.checked).toBe(true);
      expect(texts(byId(renderer, 'share-all-users-description'))).toEqual(['방문자는 컬렉션의 링크를 볼 수만 있습니다.']);
      await turnPublic(renderer, true);
      expect(enableCollectionShare).toHaveBeenCalledWith(expect.anything(), 5, 'read');
      // On: ON is the chosen side, and the URL is not shown anywhere.
      expect(isPublicOn(renderer)).toBe(true);
      for (const gone of ['share-all-users-status', 'share-link', 'share-link-row']) {
        expect(exists(renderer, gone)).toBe(false);
      }
      expect(texts(renderer).some(text => text.includes('https://juple.test/c/p'))).toBe(false);

      // The share action: icon-only, a full 44dp target, in the header right after (end side of) the
      // switch, close to it.
      const shareAction = renderer.root.findAll(node => node.props.testID === 'share-link-action' && typeof node.props.onPress === 'function')[0];
      expect(shareAction.props.accessibilityLabel).toBe('컬렉션 링크 공유');
      const actionStyle = StyleSheet.flatten(shareAction.props.style);
      expect(actionStyle).toEqual(expect.objectContaining({ minHeight: 44, minWidth: 44 }));
      expect(actionStyle.backgroundColor).toBeUndefined();
      expect(actionStyle.borderWidth).toBeUndefined();
      const header = renderer.root.findAll(node => node.type === Text && node.props.children === '컬렉션 공개' && node.props.accessibilityRole === 'header')[0].parent!;
      const headerOrder = header.findAll(node => typeof node.type === 'string' && ['share-link-action', 'share-public-toggle'].includes(node.props.testID))
        .map(node => node.props.testID);
      expect(headerOrder.filter((id, index) => headerOrder.indexOf(id) === index)).toEqual(['share-public-toggle', 'share-link-action']);
      const trailing = header.findAll(node => typeof node.type === 'string' && StyleSheet.flatten(node.props.style)?.flexDirection === 'row'
        && node.findAll(inner => inner.props.testID === 'share-link-action').length > 0
        && node.findAll(inner => inner.props.testID === 'share-public-toggle').length > 0);
      expect(StyleSheet.flatten(trailing[trailing.length - 1].props.style).gap).toBeLessThanOrEqual(8);
      // ON: exactly [switch][share icon], the icon taking its own place after the switch.
      expect(trailing[trailing.length - 1].children).toHaveLength(2);
      // Not in the card body any more (neither in the permission field nor below the description).
      const permissionField = renderer.root.findAll(node => node.type === Text && node.props.children === '권한')[0].parent!;
      expect(permissionField.findAll(node => node.props.testID === 'share-link-action')).toHaveLength(0);
      await act(async () => {
        await shareAction.props.onPress();
      });
      // The Owner's action is the OS share sheet with the URL - never the member's 친구 / ID sheet.
      expect(shareItem).toHaveBeenCalledWith('https://juple.test/c/p', 'Trip');
      expect(exists(renderer, 'link-share-sheet')).toBe(false);

      expect(isPublicOn(renderer)).toBe(true);

      await turnPublic(renderer, false);
      expect(revokeCollectionShare).not.toHaveBeenCalled(); // asks first
      const confirm = renderer.root.findAllByType(Modal).find(modal => modal.props.visible)!;
      await act(async () => {
        confirm.findAll(node => node.props.accessibilityLabel === i18n.t('shareSheet.stopSharing') && typeof node.props.onPress === 'function')[0].props.onPress();
      });
      expect(revokeCollectionShare).toHaveBeenCalledWith(expect.anything(), 5);
      expect(isPublicOn(renderer)).toBe(false);
      expect(exists(renderer, 'share-link')).toBe(false);
      expect(exists(renderer, 'share-link-action')).toBe(false);
    });

    describe('the switch never pre-toggles (no ON -> OFF -> ON flicker)', () => {
      const confirmDialog = (renderer: Renderer) => renderer.root.findAllByType(Modal).find(modal => modal.props.visible)!;
      const stopSharingButton = (renderer: Renderer) =>
        confirmDialog(renderer).findAll(node => node.props.accessibilityLabel === i18n.t('shareSheet.stopSharing') && typeof node.props.onPress === 'function')[0];
      const cancelButton = (renderer: Renderer) =>
        confirmDialog(renderer).findAll(node => node.props.accessibilityLabel === i18n.t('common.cancel') && typeof node.props.onPress === 'function')[0];

      async function renderWithPublicOn() {
        jest.mocked(enableCollectionShare).mockResolvedValue({ publicId: 'p', shareUrl: 'https://juple.test/c/p', createdAtUtc: '', permission: 'read' });
        const renderer = await renderScreen();
        await turnPublic(renderer, true);
        expect(isPublicOn(renderer)).toBe(true);
        return renderer;
      }

      it('ON + tap: the switch stays ON (as shown AND as announced) while the confirmation is asked; nothing is requested yet', async () => {
        const renderer = await renderWithPublicOn();
        await turnPublic(renderer, false);

        expect(shownSwitchValue(renderer)).toBe(true);
        expect(isPublicOn(renderer)).toBe(true);
        expect(publicToggle(renderer).props.accessibilityRole).toBe('switch');
        expect(publicToggle(renderer).props.accessibilityLabel).toBe('컬렉션 공개');
        expect(revokeCollectionShare).not.toHaveBeenCalled();
        expect(stopSharingButton(renderer)).toBeTruthy();
        // The visual switch is not a touch target of its own - only the Pressable around it takes the tap.
        expect(publicToggle(renderer).findByType(Switch).parent!.props.pointerEvents).toBe('none');
      });

      it('cancel leaves it ON - it never moved', async () => {
        const renderer = await renderWithPublicOn();
        await turnPublic(renderer, false);
        await act(async () => {
          cancelButton(renderer).props.onPress();
        });

        expect(shownSwitchValue(renderer)).toBe(true);
        expect(isPublicOn(renderer)).toBe(true);
        expect(revokeCollectionShare).not.toHaveBeenCalled();
      });

      it('confirm: still ON while the request is in flight, OFF only once it succeeded', async () => {
        const renderer = await renderWithPublicOn();
        let finish!: () => void;
        jest.mocked(revokeCollectionShare).mockReturnValue(new Promise<void>(resolve => { finish = resolve; }));
        await turnPublic(renderer, false);
        await act(async () => {
          stopSharingButton(renderer).props.onPress();
        });

        expect(revokeCollectionShare).toHaveBeenCalledTimes(1);
        expect(shownSwitchValue(renderer)).toBe(true);
        await act(async () => {
          finish();
        });
        expect(shownSwitchValue(renderer)).toBe(false);
        expect(isPublicOn(renderer)).toBe(false);
      });

      it('a failed stop leaves it ON and shows the error', async () => {
        const renderer = await renderWithPublicOn();
        jest.mocked(revokeCollectionShare).mockRejectedValue(new Error('boom'));
        await turnPublic(renderer, false);
        await act(async () => {
          stopSharingButton(renderer).props.onPress();
        });

        expect(shownSwitchValue(renderer)).toBe(true);
        expect(isPublicOn(renderer)).toBe(true);
        expect(texts(renderer)).toContain(i18n.t('item.shareError'));
      });

      it('OFF -> ON still works at once, and rapid taps send one enable request', async () => {
        jest.mocked(enableCollectionShare).mockReturnValue(new Promise(() => undefined));
        const renderer = await renderScreen();
        expect(isPublicOn(renderer)).toBe(false);

        await act(async () => {
          const toggle = publicToggle(renderer);
          toggle.props.onPress();
          toggle.props.onPress();
          toggle.props.onPress();
        });

        expect(enableCollectionShare).toHaveBeenCalledTimes(1);
      });
    });

    it('작성 chosen before starting changes the description and creates a writable link', async () => {
      jest.mocked(enableCollectionShare).mockResolvedValue({ publicId: 'p', shareUrl: 'https://juple.test/c/p', createdAtUtc: '', permission: 'write' });
      const renderer = await renderScreen();

      await press(renderer, 'share-all-users-permission-write');
      expect(setCollectionSharePermission).not.toHaveBeenCalled();
      expect(texts(byId(renderer, 'share-all-users-description'))).toEqual(['방문자는 컬렉션에 링크를 추가할 수 있습니다.']);
      await turnPublic(renderer, true);
      expect(enableCollectionShare).toHaveBeenCalledWith(expect.anything(), 5, 'write');
      expect(byId(renderer, 'share-all-users-permission-write').props.accessibilityState.checked).toBe(true);
    });

    it('switching an active link between 읽기 and 작성 is saved at once', async () => {
      jest.mocked(getCollectionShare).mockResolvedValue({ publicId: 'p', shareUrl: 'https://juple.test/c/p', createdAtUtc: '', permission: 'read' });
      jest.mocked(setCollectionSharePermission).mockResolvedValue({ publicId: 'p', shareUrl: 'https://juple.test/c/p', createdAtUtc: '', permission: 'write' });
      const renderer = await renderScreen();

      await press(renderer, 'share-all-users-permission-write');
      expect(setCollectionSharePermission).toHaveBeenCalledWith(expect.anything(), 5, 'write');
      expect(byId(renderer, 'share-all-users-permission-write').props.accessibilityState.checked).toBe(true);
      expect(enableCollectionShare).not.toHaveBeenCalled();
    });

    it('a locked Collection says visitors need the lock password too', async () => {
      jest.mocked(getCollection).mockResolvedValue({ ...collection, isLocked: true });
      const renderer = await renderScreen();

      expect(texts(byId(renderer, 'share-locked-note'))).toContain(i18n.t('shareSheet.lockedLinkNote'));
    });

    it('읽기 members and pending 읽기 invitations coexist with it', async () => {
      jest.mocked(getCollectionParticipants).mockResolvedValue(readersOnly);
      const renderer = await renderScreen();

      expect(exists(renderer, 'share-public-blocked')).toBe(false);
      expect(publicToggle(renderer).props.disabled).toBe(false);
    });

    it('읽기 전용 for everyone is the minimum: people who can add links may stay as they are', async () => {
      jest.mocked(getCollectionParticipants).mockResolvedValue({ ...withWriter, participants: [owner, withWriter.participants[2]] });
      const renderer = await renderScreen();

      expect(exists(renderer, 'share-public-blocked')).toBe(false);
      expect(publicToggle(renderer).props.disabled).toBe(false);
      await turnPublic(renderer, true);
      expect(enableCollectionShare).toHaveBeenCalledWith(expect.anything(), 5, 'read');
      expect(changeCollaboratorRole).not.toHaveBeenCalled();
    });

    it('링크 추가 for everyone while someone is 읽기 전용: nothing is blocked or shown in red - turning it on asks first, and only a yes changes them', async () => {
      jest.mocked(getCollectionParticipants).mockResolvedValue(readersOnly);
      jest.mocked(enableCollectionShare).mockResolvedValue({ publicId: 'p', shareUrl: 'https://juple.test/c/p', createdAtUtc: '', permission: 'write' });
      const renderer = await renderScreen();
      await press(renderer, 'share-all-users-permission-write');

      // No passive blocking notice and the control stays usable.
      expect(publicToggle(renderer).props.disabled).toBe(false);
      expect(exists(renderer, 'share-public-blocked')).toBe(false);
      expect(texts(renderer.root)).not.toContain(i18n.t('shareSheet.permissionMismatch'));

      await turnPublic(renderer, true);
      // The question, with who it affects (the reader and the pending reader) - nothing sent yet.
      expect(enableCollectionShare).not.toHaveBeenCalled();
      expect(raisePrompt(renderer).props.message).toBe(i18n.t('shareSheet.raiseRolesMessage', { count: 2, permission: i18n.t('shareSheet.permissionWrite') }));
      expect(changeCollaboratorRole).not.toHaveBeenCalled();
      expect(changeInvitationRole).not.toHaveBeenCalled();

      // No: nothing changes - still off, still asking for nothing.
      await act(async () => {
        raisePrompt(renderer).props.onCancel();
      });
      expect(raisePrompt(renderer)).toBeUndefined();
      expect(enableCollectionShare).not.toHaveBeenCalled();
      expect(isPublicOn(renderer)).toBe(false);

      // Yes: the server turns it on and raises them in one request, then the lists are read again.
      await turnPublic(renderer, true);
      jest.mocked(getCollectionParticipants).mockClear();
      await act(async () => {
        raisePrompt(renderer).props.onConfirm();
      });
      expect(enableCollectionShare).toHaveBeenCalledWith(expect.anything(), 5, 'write', { raiseLowerRoles: true });
      expect(isPublicOn(renderer)).toBe(true);
      expect(getCollectionParticipants).toHaveBeenCalled();
      // The people are raised by that one request - never by separate per-person calls.
      expect(changeCollaboratorRole).not.toHaveBeenCalled();
      expect(changeInvitationRole).not.toHaveBeenCalled();

      // Everyone is 링크 추가 already: no question at all.
      jest.mocked(enableCollectionShare).mockClear();
      jest.mocked(getCollectionParticipants).mockResolvedValue({ ...withWriter, participants: [owner, withWriter.participants[2]], pendingInvitations: [] });
      const writable = await renderScreen();
      await press(writable, 'share-all-users-permission-write');
      await turnPublic(writable, true);
      expect(raisePrompt(writable)).toBeUndefined();
      expect(enableCollectionShare).toHaveBeenCalledWith(expect.anything(), 5, 'write');
    });

    it.each([
      ['읽기 전용 members and invitations', () => readersOnly],
      ['a member and an invitation who can add links', () => ({ ...withWriter, participants: [owner, withWriter.participants[2]] })],
    ])('turning 모든 사용자 on as 읽기 전용 with %s succeeds - no permission reason at all', async (_label, participants) => {
      jest.mocked(getCollectionParticipants).mockResolvedValue(participants());
      const renderer = await renderScreen();

      expect(byId(renderer, 'share-all-users-permission-read').props.accessibilityState.checked).toBe(true);
      expect(exists(renderer, 'share-public-blocked')).toBe(false);
      await turnPublic(renderer, true);

      expect(enableCollectionShare).toHaveBeenCalledWith(expect.anything(), 5, 'read');
      expect(texts(renderer.root)).not.toContain(i18n.t('shareSheet.permissionMismatch'));
    });

    it('the 링크 추가 reason is never shown for a 읽기 전용 attempt, even if the server refuses it', async () => {
      jest.mocked(getCollectionParticipants).mockResolvedValue(readersOnly);
      jest.mocked(enableCollectionShare).mockRejectedValue(new ApiError('conflict', 409, 'publicSharePermissionMismatch'));
      const renderer = await renderScreen();

      await turnPublic(renderer, true);

      expect(texts(renderer.root)).not.toContain(i18n.t('shareSheet.permissionMismatch'));
      expect(texts(renderer.root)).toContain(i18n.t('collections.errorShareManagementFallback'));
    });

    it('an unrelated conflict (collaborationActive) is never described as a permission problem', async () => {
      jest.mocked(getCollectionShare).mockResolvedValue({ publicId: 'p', shareUrl: 'https://juple.test/c/p', createdAtUtc: '', permission: 'read' });
      jest.mocked(getCollectionParticipants).mockResolvedValue({ ...withWriter, participants: [owner, withWriter.participants[2]], pendingInvitations: [] });
      jest.mocked(setCollectionSharePermission).mockRejectedValue(new ApiError('conflict', 409, 'collaborationActive'));
      const renderer = await renderScreen();

      await press(renderer, 'share-all-users-permission-write');

      expect(texts(renderer.root)).not.toContain(i18n.t('shareSheet.permissionMismatch'));
      expect(texts(renderer.root)).toContain(i18n.t('collections.errorShareManagementFallback'));
    });

    it('an active 읽기 전용 link switched to 링크 추가 while someone is below it: no red message - saying no leaves the selector exactly where it was', async () => {
      jest.mocked(getCollectionShare).mockResolvedValue({ publicId: 'p', shareUrl: 'https://juple.test/c/p', createdAtUtc: '', permission: 'read' });
      jest.mocked(getCollectionParticipants).mockResolvedValue(readersOnly);
      const renderer = await renderScreen();

      await press(renderer, 'share-all-users-permission-write');
      expect(raisePrompt(renderer)).toBeDefined();
      expect(texts(renderer.root)).not.toContain(i18n.t('shareSheet.permissionMismatch'));
      // Asked, not yet applied: the selector still shows the link's own permission.
      expect(byId(renderer, 'share-all-users-permission-read').props.accessibilityState.checked).toBe(true);

      await act(async () => {
        raisePrompt(renderer).props.onCancel();
      });
      expect(setCollectionSharePermission).not.toHaveBeenCalled();
      expect(byId(renderer, 'share-all-users-permission-read').props.accessibilityState.checked).toBe(true);
      expect(byId(renderer, 'share-all-users-permission-write').props.accessibilityState.checked).toBe(false);
      expect(texts(renderer.root)).not.toContain(i18n.t('shareSheet.permissionMismatch'));
    });

    it('before the link exists: choosing 링크 추가 shows no reason and blocks nothing; the question comes when turning it on', async () => {
      jest.mocked(getCollectionParticipants).mockResolvedValue(readersOnly);
      const renderer = await renderScreen();

      await press(renderer, 'share-all-users-permission-write');
      expect(exists(renderer, 'share-public-blocked')).toBe(false);
      expect(raisePrompt(renderer)).toBeUndefined();
      expect(publicToggle(renderer).props.disabled).toBe(false);
      await press(renderer, 'share-all-users-permission-read');

      expect(texts(renderer.root)).not.toContain(i18n.t('shareSheet.permissionMismatch'));
      expect(publicToggle(renderer).props.disabled).toBe(false);
    });

    it('lowering an active 링크 추가 link to 읽기 전용 is always allowed - people who can add links keep it', async () => {
      jest.mocked(getCollectionShare).mockResolvedValue({ publicId: 'p', shareUrl: 'https://juple.test/c/p', createdAtUtc: '', permission: 'write' });
      jest.mocked(setCollectionSharePermission).mockResolvedValue({ publicId: 'p', shareUrl: 'https://juple.test/c/p', createdAtUtc: '', permission: 'read' });
      jest.mocked(getCollectionParticipants).mockResolvedValue({ ...withWriter, participants: [owner, withWriter.participants[2]] });
      const renderer = await renderScreen();

      await press(renderer, 'share-all-users-permission-read');

      expect(setCollectionSharePermission).toHaveBeenCalledWith(expect.anything(), 5, 'read');
      expect(changeCollaboratorRole).not.toHaveBeenCalled();
    });

    it('switching an active link to a permission some people do not have: a yes saves it and raises them in the same request', async () => {
      jest.mocked(getCollectionShare).mockResolvedValue({ publicId: 'p', shareUrl: 'https://juple.test/c/p', createdAtUtc: '', permission: 'read' });
      jest.mocked(getCollectionParticipants).mockResolvedValue(readersOnly);
      jest.mocked(setCollectionSharePermission).mockResolvedValue({ publicId: 'p', shareUrl: 'https://juple.test/c/p', createdAtUtc: '', permission: 'write' });
      const renderer = await renderScreen();

      await press(renderer, 'share-all-users-permission-write');
      expect(setCollectionSharePermission).not.toHaveBeenCalled();
      expect(raisePrompt(renderer).props.message).toBe(i18n.t('shareSheet.raiseRolesMessage', { count: 2, permission: i18n.t('shareSheet.permissionWrite') }));

      jest.mocked(getCollectionParticipants).mockResolvedValue({ ...withWriter, participants: [owner, { ...readersOnly.participants[1], role: 'contributor' }], pendingInvitations: [] });
      await act(async () => {
        raisePrompt(renderer).props.onConfirm();
      });
      expect(setCollectionSharePermission).toHaveBeenCalledWith(expect.anything(), 5, 'write', { raiseLowerRoles: true });
      expect(byId(renderer, 'share-all-users-permission-write').props.accessibilityState.checked).toBe(true);
      expect(changeCollaboratorRole).not.toHaveBeenCalled();
      expect(changeInvitationRole).not.toHaveBeenCalled();
    });

    describe('"함께 변경" really changes the roles, and the screen shows it', () => {
      const activeRead = { publicId: 'p', shareUrl: 'https://juple.test/c/p', createdAtUtc: '', permission: 'read' as const };
      const confirm = async (renderer: Renderer) => {
        await act(async () => {
          raisePrompt(renderer).props.onConfirm();
        });
      };
      const chipLabels = (renderer: Renderer) => texts(byId(renderer, 'share-status'));

      it.each([
        ['읽기 전용 -> 승인 후 추가', 'submit', 'submitter', 2],
        ['읽기 전용 -> 링크 추가', 'write', 'contributor', 2],
      ] as const)('%s: the member and the pending invitation below it are raised by the server in one request, then the lists are read again', async (_label, permission, role, count) => {
        jest.mocked(getCollectionShare).mockResolvedValue(activeRead);
        jest.mocked(getCollectionParticipants).mockResolvedValue(readersOnly);
        jest.mocked(setCollectionSharePermission).mockResolvedValue({ ...activeRead, permission });
        const renderer = await renderScreen();

        await press(renderer, `share-all-users-permission-${permission}`);
        expect(raisePrompt(renderer).props.message).toBe(i18n.t('shareSheet.raiseRolesMessage', { count, permission: i18n.t(permission === 'write' ? 'shareSheet.permissionWrite' : 'shareSheet.permissionSubmit') }));
        expect(chipLabels(renderer)).toContain(i18n.t('shareSheet.permissionRead'));

        // The server now holds the raised roles.
        const raised = { ...readersOnly, participants: [owner, { ...readersOnly.participants[1], role }], pendingInvitations: [{ ...readersOnly.pendingInvitations[0], role: role === 'submitter' ? 'Submitter' : 'Contributor' }] };
        jest.mocked(getCollectionParticipants).mockResolvedValue(raised as never);
        jest.mocked(getCollectionParticipants).mockClear();
        await confirm(renderer);
        // The list reload finished before the screen settled - the chips below are the server's.
        expect(getCollectionParticipants).toHaveBeenCalledTimes(1);
        expect(changeCollaboratorRole).not.toHaveBeenCalled();
        expect(changeInvitationRole).not.toHaveBeenCalled();

        expect(setCollectionSharePermission).toHaveBeenCalledTimes(1);
        expect(setCollectionSharePermission).toHaveBeenCalledWith(expect.anything(), 5, permission, { raiseLowerRoles: true });
        // The new permission, the new roles on screen, and no conflict text anywhere.
        expect(byId(renderer, `share-all-users-permission-${permission}`).props.accessibilityState.checked).toBe(true);
        expect(chipLabels(renderer)).not.toContain(i18n.t('shareSheet.permissionRead'));
        expect(texts(renderer.root)).not.toContain(i18n.t('shareSheet.permissionMismatch'));
        expect(texts(renderer.root)).not.toContain(i18n.t('collections.errorShareManagementFallback'));
        expect(raisePrompt(renderer)).toBeUndefined();
      });

      it('승인 후 추가 -> 링크 추가: only those below 링크 추가 are raised - a member who is already 링크 추가 is untouched', async () => {
        jest.mocked(getCollectionShare).mockResolvedValue({ ...activeRead, permission: 'submit' });
        jest.mocked(getCollectionParticipants).mockResolvedValue({
          participants: [owner, { jupleId: 'SUBM2345', displayName: '꼬부기', role: 'submitter' }, { jupleId: 'WRTR2345', displayName: '파이리', role: 'contributor' }],
          pendingInvitations: [], canManage: true,
        });
        jest.mocked(setCollectionSharePermission).mockResolvedValue({ ...activeRead, permission: 'write' });
        const renderer = await renderScreen();

        await press(renderer, 'share-all-users-permission-write');
        // One person is below it - the one already at 링크 추가 is not counted.
        expect(raisePrompt(renderer).props.message).toBe(i18n.t('shareSheet.raiseRolesMessage', { count: 1, permission: i18n.t('shareSheet.permissionWrite') }));
        await confirm(renderer);

        expect(setCollectionSharePermission).toHaveBeenCalledWith(expect.anything(), 5, 'write', { raiseLowerRoles: true });
        expect(changeCollaboratorRole).not.toHaveBeenCalled();
      });

      it('409 on the confirmed request (someone lower is still there): the lists are re-read, the conflict re-evaluated, and the question comes again - nobody is changed one by one', async () => {
        jest.mocked(getCollectionShare).mockResolvedValue(activeRead);
        jest.mocked(getCollectionParticipants).mockResolvedValue(readersOnly);
        jest.mocked(setCollectionSharePermission).mockRejectedValue(new ApiError('conflict', 409, 'publicSharePermissionMismatch'));
        const renderer = await renderScreen();

        await press(renderer, 'share-all-users-permission-write');
        jest.mocked(getCollectionParticipants).mockClear();
        await confirm(renderer);

        expect(setCollectionSharePermission).toHaveBeenCalledTimes(1);
        expect(setCollectionSharePermission).toHaveBeenCalledWith(expect.anything(), 5, 'write', { raiseLowerRoles: true });
        // Re-read, then asked again from the fresh state - never the red message, never per-person calls.
        expect(getCollectionParticipants).toHaveBeenCalled();
        expect(raisePrompt(renderer)).toBeDefined();
        expect(texts(renderer.root)).not.toContain(i18n.t('shareSheet.permissionMismatch'));
        expect(changeCollaboratorRole).not.toHaveBeenCalled();
        expect(changeInvitationRole).not.toHaveBeenCalled();
      });

      it('409, but the re-read shows nobody below it any more: the plain change goes through, still with no per-person calls', async () => {
        jest.mocked(getCollectionShare).mockResolvedValue(activeRead);
        jest.mocked(getCollectionParticipants).mockResolvedValue(readersOnly);
        jest.mocked(setCollectionSharePermission)
          .mockRejectedValueOnce(new ApiError('conflict', 409, 'publicSharePermissionMismatch'))
          .mockResolvedValueOnce({ ...activeRead, permission: 'write' });
        const renderer = await renderScreen();

        await press(renderer, 'share-all-users-permission-write');
        // The invitee answered / was raised elsewhere meanwhile: nothing is below 링크 추가 now.
        jest.mocked(getCollectionParticipants).mockResolvedValue({ participants: [owner], pendingInvitations: [], canManage: true });
        await confirm(renderer);

        expect(setCollectionSharePermission).toHaveBeenNthCalledWith(1, expect.anything(), 5, 'write', { raiseLowerRoles: true });
        expect(setCollectionSharePermission).toHaveBeenNthCalledWith(2, expect.anything(), 5, 'write');
        expect(byId(renderer, 'share-all-users-permission-write').props.accessibilityState.checked).toBe(true);
        expect(raisePrompt(renderer)).toBeUndefined();
        expect(texts(renderer.root)).not.toContain(i18n.t('shareSheet.permissionMismatch'));
        expect(changeCollaboratorRole).not.toHaveBeenCalled();
        expect(changeInvitationRole).not.toHaveBeenCalled();
      });

      it('an unrelated failure of the confirmed request shows the common error - no prompt, no per-person calls', async () => {
        jest.mocked(getCollectionShare).mockResolvedValue(activeRead);
        jest.mocked(getCollectionParticipants).mockResolvedValue(readersOnly);
        jest.mocked(setCollectionSharePermission).mockRejectedValue(new ApiError('unavailable', 503));
        const renderer = await renderScreen();

        await press(renderer, 'share-all-users-permission-write');
        await confirm(renderer);

        expect(raisePrompt(renderer)).toBeUndefined();
        expect(texts(renderer.root)).toContain(i18n.t('collections.errorShareManagementFallback'));
        expect(changeCollaboratorRole).not.toHaveBeenCalled();
        expect(changeInvitationRole).not.toHaveBeenCalled();
      });

      it('no changes anywhere when the Owner says no', async () => {
        jest.mocked(getCollectionShare).mockResolvedValue(activeRead);
        jest.mocked(getCollectionParticipants).mockResolvedValue(readersOnly);
        const renderer = await renderScreen();

        await press(renderer, 'share-all-users-permission-submit');
        await act(async () => {
          raisePrompt(renderer).props.onCancel();
        });

        expect(setCollectionSharePermission).not.toHaveBeenCalled();
        expect(changeCollaboratorRole).not.toHaveBeenCalled();
        expect(changeInvitationRole).not.toHaveBeenCalled();
        expect(byId(renderer, 'share-all-users-permission-read').props.accessibilityState.checked).toBe(true);
      });
    });

    it('someone lower appeared since the lists were read (the server refuses): the lists are re-read and the same question is asked - never a red message', async () => {
      jest.mocked(getCollectionShare).mockResolvedValue({ publicId: 'p', shareUrl: 'https://juple.test/c/p', createdAtUtc: '', permission: 'read' });
      jest.mocked(getCollectionParticipants).mockResolvedValue({ ...withWriter, participants: [owner, withWriter.participants[2]], pendingInvitations: [] });
      jest.mocked(setCollectionSharePermission).mockRejectedValueOnce(new ApiError('conflict', 409, 'publicSharePermissionMismatch'));
      const renderer = await renderScreen();

      jest.mocked(getCollectionParticipants).mockResolvedValue(readersOnly);
      await press(renderer, 'share-all-users-permission-write');

      expect(raisePrompt(renderer)).toBeDefined();
      expect(texts(renderer.root)).not.toContain(i18n.t('shareSheet.permissionMismatch'));
      expect(texts(renderer.root)).not.toContain(i18n.t('collections.errorShareManagementFallback'));
    });
  });

  describe('친구 초대 / ID 초대하기 - one batch, each person with their own 읽기/쓰기', () => {
    it('picked friends join with 읽기, each can be switched on its own, and each invitation carries that role', async () => {
      jest.mocked(getFriends).mockResolvedValue({
        items: [friend('FRND2345', '피카츄', '회사 개발팀'), friend('FRNE2345', '파이리')],
        nextCursor: null,
      });
      const renderer = await renderScreen();
      await pickFriends(renderer, ['FRND2345', 'FRNE2345']);

      expect(byId(renderer, 'draft-role-FRND2345-viewer').props.accessibilityState.checked).toBe(true);
      expect(byId(renderer, 'draft-role-FRNE2345-viewer').props.accessibilityState.checked).toBe(true);
      // My private note is shown in the picker only, never in the batch.
      expect(texts(byId(renderer, 'share-invite-list'))).not.toContain('회사 개발팀');

      await press(renderer, 'draft-role-FRNE2345-contributor');
      await press(renderer, 'invite-send');

      expect(inviteCollaborator).toHaveBeenCalledTimes(2);
      expect(inviteCollaborator).toHaveBeenCalledWith(expect.anything(), 5, 'FRND2345', 'viewer');
      expect(inviteCollaborator).toHaveBeenCalledWith(expect.anything(), 5, 'FRNE2345', 'contributor');
      expect(lookupJupleId).not.toHaveBeenCalled();
      // No "N명에게 초대를 보냈어요." - the batch clears and the lists refresh; that is the feedback.
      expect(JSON.stringify(texts(renderer))).not.toMatch(/초대를 보냈어요/);
      expect(exists(renderer, 'invite-notice')).toBe(false);
      expect(exists(renderer, 'share-invite-list')).toBe(false);
      expect(getCollectionParticipants).toHaveBeenCalledTimes(2); // once on open, once after sending
    });

    it('ID 초대하기 looks up only on 찾기, shows name and ID, and adds the person with the chosen permission', async () => {
      const renderer = await renderScreen();
      await openIdTab(renderer);
      await act(async () => {
        byId(renderer, 'id-invite-input').props.onChangeText('NAMD-2345');
      });
      expect(lookupJupleId).not.toHaveBeenCalled();

      await press(renderer, 'id-invite-find');
      const person = byId(renderer, 'id-invite-person');
      expect(texts(person)).toEqual(expect.arrayContaining(['이상해씨', 'NAMD-2345']));

      await press(renderer, 'id-invite-role-contributor');
      await press(renderer, 'id-invite-add');
      expect(byId(renderer, 'draft-role-NAMD2345-contributor').props.accessibilityState.checked).toBe(true);

      await press(renderer, 'invite-send');
      expect(inviteCollaborator).toHaveBeenCalledWith(expect.anything(), 5, 'NAMD2345', 'contributor');
    });

    it('the result shows who with "+" on one line, then 권한 over their choice; "+" adds them and clears the field', async () => {
      const renderer = await renderScreen();
      for (const jupleId of ['AAAA2345', 'BBBB2345', 'CCCC2345']) {
        await findById(renderer, jupleId);
        const row = renderer.root.find(node => typeof node.type === 'string' && node.props.testID === 'id-invite-person');
        const [whoLine, permissionBlock] = row.children.filter(child => typeof child !== 'string') as ReactTestRenderer.ReactTestInstance[];
        expect(whoLine.findAll(node => node.props.testID === 'id-invite-add').length).toBeGreaterThan(0);
        expect(permissionBlock.props.testID).toBe('id-invite-permission');
        expect(texts(permissionBlock)[0]).toBe('권한');
        expect(byId(renderer, 'id-invite-add').props.accessibilityLabel).toContain(jupleId.slice(0, 4));
        await press(renderer, 'id-invite-add');
        expect(byId(renderer, 'id-invite-input').props.value).toBe('');
        expect(exists(renderer, 'id-invite-person')).toBe(false);
      }
      await press(renderer, 'draft-role-BBBB2345-contributor');

      expect(texts(byId(renderer, 'share-invite-list-count'))).toEqual([i18n.t('shareSheet.selectedCount', { count: 3 })]);
      await press(renderer, 'invite-send');
      expect(inviteCollaborator).toHaveBeenCalledTimes(3);
      expect(inviteCollaborator).toHaveBeenCalledWith(expect.anything(), 5, 'AAAA2345', 'viewer');
      expect(inviteCollaborator).toHaveBeenCalledWith(expect.anything(), 5, 'BBBB2345', 'contributor');
      expect(inviteCollaborator).toHaveBeenCalledWith(expect.anything(), 5, 'CCCC2345', 'viewer');
    });

    it('friends and Juple IDs go out together in one batch through the same invitation flow', async () => {
      jest.mocked(getFriends).mockResolvedValue({ items: [friend('FRND2345', '피카츄')], nextCursor: null });
      const renderer = await renderScreen();
      await pickFriends(renderer, ['FRND2345']);
      await findById(renderer, 'BBBB2345');
      await press(renderer, 'id-invite-add');

      await press(renderer, 'invite-send');
      expect(inviteCollaborator).toHaveBeenCalledWith(expect.anything(), 5, 'FRND2345', 'viewer');
      expect(inviteCollaborator).toHaveBeenCalledWith(expect.anything(), 5, 'BBBB2345', 'viewer');
    });

    it('refuses yourself, someone already sharing it, someone already invited, and anyone already in the batch', async () => {
      jest.mocked(getCollectionParticipants).mockResolvedValue(readersOnly);
      const renderer = await renderScreen();

      await findById(renderer, 'WNER2345');
      expect(texts(byId(renderer, 'id-invite-error'))).toContain(i18n.t('collaboration.cannotInviteSelf'));
      await findById(renderer, 'RDER2345');
      expect(texts(byId(renderer, 'id-invite-error'))).toContain(i18n.t('collaboration.alreadyCollaborator'));
      await findById(renderer, 'PNDRD234');
      expect(texts(byId(renderer, 'id-invite-error'))).toContain(i18n.t('collaboration.invitationAlreadyPending'));

      await findById(renderer, 'CCCC2345');
      await press(renderer, 'id-invite-add');
      await findById(renderer, 'CCCC2345');
      expect(texts(byId(renderer, 'id-invite-error'))).toContain(i18n.t('shareSheet.duplicateInvitee'));
      expect(inviteCollaborator).not.toHaveBeenCalled();
    });

    it('reports each person on their own - one failure never undoes another invitation - and a double tap sends once', async () => {
      jest.mocked(inviteCollaborator).mockImplementation(async (_request, _id, jupleId) => {
        if (jupleId === 'DDDD2345') {
          throw new ApiError('conflict', 409, 'invitationPending');
        }
        return { invitationId: 1, jupleId, role: 'Viewer', createdAtUtc: '', expiresAtUtc: '' };
      });
      const renderer = await renderScreen();
      await findById(renderer, 'DDDD2345');
      await press(renderer, 'id-invite-add');
      await findById(renderer, 'EEEE2345');
      await press(renderer, 'id-invite-add');

      await act(async () => {
        const send = byId(renderer, 'invite-send').props.onPress;
        await Promise.all([send(), send()]);
      });

      expect(inviteCollaborator).toHaveBeenCalledTimes(2);
      expect(exists(renderer, 'draft-EEEE2345')).toBe(false);
      expect(texts(byId(renderer, 'draft-error-DDDD2345'))).toContain(i18n.t('collaboration.invitationAlreadyPending'));
    });

    it('any number of friends can join one batch; they are invited a few at a time, each with their own result', async () => {
      jest.mocked(getFriends).mockResolvedValue({
        items: Array.from({ length: 12 }, (_, index) => friend(`F${String(index).padStart(3, '0')}2345`, null)),
        nextCursor: null,
      });
      let inFlight = 0;
      let maxInFlight = 0;
      jest.mocked(inviteCollaborator).mockImplementation(async () => {
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await new Promise<void>(resolve => setTimeout(resolve, 0));
        inFlight -= 1;
        return {} as never;
      });
      const renderer = await renderScreen();
      await press(renderer, 'invite-choose-friends');
      await act(async () => {
        await new Promise<void>(resolve => setTimeout(resolve, 0));
      });
      const picker = byId(renderer, 'friend-picker');
      await act(async () => {
        picker.findAll(node => /^friend-picker-F\d{3}2345$/.test(String(node.props.testID ?? '')) && typeof node.props.onPress === 'function')
          .forEach(node => node.props.onPress());
      });
      await press(renderer, 'friend-picker-confirm');

      const draftRows = renderer.root.findAll(node => typeof node.type === 'string' && /^draft-F\d{3}2345$/.test(String(node.props.testID ?? '')));
      expect(draftRows).toHaveLength(12);
      expect(byId(renderer, 'invite-choose-friends').props.disabled).toBe(false);

      await act(async () => {
        await byId(renderer, 'invite-send').props.onPress();
      });
      expect(inviteCollaborator).toHaveBeenCalledTimes(12);
      expect(maxInFlight).toBeLessThanOrEqual(INVITE_CONCURRENCY);
    });

    it('while the link is 읽기 전용, each person invited still gets their own choice - and that is what is sent', async () => {
      jest.mocked(getCollectionShare).mockResolvedValue({ publicId: 'p', shareUrl: 'https://juple.test/c/p', createdAtUtc: '', permission: 'read' });
      const renderer = await renderScreen();

      expect(exists(renderer, 'share-invite-fixed-role')).toBe(false);
      await findById(renderer, 'CCCC2345');
      await press(renderer, 'id-invite-role-contributor');
      await press(renderer, 'id-invite-add');
      await findById(renderer, 'EEEE2345');
      await press(renderer, 'id-invite-add');
      expect(byId(renderer, 'draft-role-CCCC2345-contributor').props.accessibilityState.checked).toBe(true);
      expect(byId(renderer, 'draft-role-EEEE2345-viewer').props.accessibilityState.checked).toBe(true);
      await press(renderer, 'invite-send');

      expect(inviteCollaborator).toHaveBeenCalledWith(expect.anything(), 5, 'CCCC2345', 'contributor');
      expect(inviteCollaborator).toHaveBeenCalledWith(expect.anything(), 5, 'EEEE2345', 'viewer');
    });

    it('while the link is 링크 추가, 읽기 전용 and 승인 후 추가 are greyed out; a tap on them only says why - nothing changes - and 링크 추가 is what is sent', async () => {
      jest.mocked(getCollectionShare).mockResolvedValue({ publicId: 'p', shareUrl: 'https://juple.test/c/p', createdAtUtc: '', permission: 'write' });
      jest.mocked(getFriends).mockResolvedValue({ items: [friend('FRND2345', '피카츄')], nextCursor: null });
      const renderer = await renderScreen();
      const reason = '컬렉션 공개 권한보다 낮은 권한은 부여할 수 없습니다.';
      expect(i18n.t('shareSheet.belowPublicPermission')).toBe(reason);

      expect(exists(renderer, 'share-invite-fixed-role')).toBe(false);
      const option = (testID: string) => renderer.root.findAll(node => node.props.testID === testID && typeof node.props.onPress === 'function')[0];
      /** Looks disabled, but still hears a tap (never a native disabled press) - and the tap only explains. */
      const tapUnavailable = async (unavailableId: string, selectedId: string) => {
        const unavailable = option(unavailableId);
        expect(unavailable.props.disabled).toBe(false);
        expect(unavailable.props.accessibilityState).toEqual({ checked: false, disabled: true });
        expect(StyleSheet.flatten(unavailable.findByType(Text).props.style)).toEqual(expect.objectContaining({ textDecorationLine: 'line-through', color: colors.border }));
        jest.mocked(inviteCollaborator).mockClear();
        await act(async () => {
          unavailable.props.onPress();
        });
        expect(texts(renderer)).toContain(reason); // the app's own transient toast (iOS and Android alike)
        expect(option(unavailableId).props.accessibilityState.checked).toBe(false);
        expect(option(selectedId).props.accessibilityState.checked).toBe(true);
        expect(inviteCollaborator).not.toHaveBeenCalled();
      };

      // B. the Juple ID search result
      await findById(renderer, 'DDDD2345');
      await tapUnavailable('id-invite-role-viewer', 'id-invite-role-contributor');
      await tapUnavailable('id-invite-role-submitter', 'id-invite-role-contributor');
      expect(texts(byId(renderer, 'id-invite-permission'))[0]).toBe('권한');
      // C. the person in the batch, before sending
      await press(renderer, 'id-invite-add');
      await tapUnavailable('draft-role-DDDD2345-viewer', 'draft-role-DDDD2345-contributor');
      await tapUnavailable('draft-role-DDDD2345-submitter', 'draft-role-DDDD2345-contributor');
      // A. a friend chosen from the list
      await press(renderer, 'share-invite-tabs-friends');
      await pickFriends(renderer, ['FRND2345']);
      await tapUnavailable('draft-role-FRND2345-viewer', 'draft-role-FRND2345-contributor');

      await press(renderer, 'invite-send');
      expect(inviteCollaborator).toHaveBeenCalledWith(expect.anything(), 5, 'DDDD2345', 'contributor');
      expect(inviteCollaborator).toHaveBeenCalledWith(expect.anything(), 5, 'FRND2345', 'contributor');
    });

    it('while the link is 승인 후 추가, only 읽기 전용 is greyed out: 승인 후 추가 is the starting choice, 링크 추가 can still be chosen', async () => {
      jest.mocked(getCollectionShare).mockResolvedValue({ publicId: 'p', shareUrl: 'https://juple.test/c/p', createdAtUtc: '', permission: 'submit' });
      jest.mocked(getFriends).mockResolvedValue({ items: [friend('FRND2345', '피카츄'), friend('GGGG2345', '파이리')], nextCursor: null });
      const renderer = await renderScreen();
      const option = (testID: string) => renderer.root.findAll(node => node.props.testID === testID && typeof node.props.onPress === 'function')[0];

      await press(renderer, 'share-invite-tabs-friends');
      await pickFriends(renderer, ['FRND2345', 'GGGG2345']);
      expect(option('draft-role-FRND2345-viewer').props.accessibilityState).toEqual({ checked: false, disabled: true });
      expect(option('draft-role-FRND2345-submitter').props.accessibilityState).toEqual({ checked: true, disabled: false });
      expect(option('draft-role-FRND2345-contributor').props.accessibilityState).toEqual({ checked: false, disabled: false });

      await act(async () => {
        option('draft-role-FRND2345-viewer').props.onPress();
      });
      expect(texts(renderer)).toContain('컬렉션 공개 권한보다 낮은 권한은 부여할 수 없습니다.');
      await press(renderer, 'draft-role-GGGG2345-contributor');
      expect(option('draft-role-GGGG2345-contributor').props.accessibilityState.checked).toBe(true);

      await press(renderer, 'invite-send');
      expect(inviteCollaborator).toHaveBeenCalledWith(expect.anything(), 5, 'FRND2345', 'submitter');
      expect(inviteCollaborator).toHaveBeenCalledWith(expect.anything(), 5, 'GGGG2345', 'contributor');
    });

    it('the public link offers three levels with their own descriptions - 읽기 전용 | 승인 후 추가 | 링크 추가', async () => {
      const renderer = await renderScreen();

      const options = renderer.root.findAll(node => typeof node.props.testID === 'string' && /^share-all-users-permission-(read|submit|write)$/.test(node.props.testID) && typeof node.props.onPress === 'function');
      expect(options.map(node => node.props.testID)).toEqual(['share-all-users-permission-read', 'share-all-users-permission-submit', 'share-all-users-permission-write']);
      expect(options.map(node => texts(node)[0])).toEqual(['읽기 전용', '승인 후 추가', '링크 추가']);
      await press(renderer, 'share-all-users-permission-submit');
      expect(texts(byId(renderer, 'share-all-users-description'))).toEqual(['링크를 제안할 수 있으며, 컬렉션 소유자가 승인한 링크만 추가됩니다.']);
      await press(renderer, 'share-all-users-permission-write');
      expect(texts(byId(renderer, 'share-all-users-description'))).toEqual(['방문자는 컬렉션에 링크를 추가할 수 있습니다.']);
      await press(renderer, 'share-all-users-permission-read');
      expect(texts(byId(renderer, 'share-all-users-description'))).toEqual(['방문자는 컬렉션의 링크를 볼 수만 있습니다.']);
      // Neutral selection, never a blue call to action; each option keeps a 44dp touch target.
      for (const node of options) {
        expect(StyleSheet.flatten(node.props.style).backgroundColor).not.toBe(colors.brand);
        expect(StyleSheet.flatten(node.props.style).minHeight + 2 * (node.props.hitSlop ?? 0)).toBeGreaterThanOrEqual(44);
      }
    });

    it.each([
      ['off', null],
      ['읽기 전용', { publicId: 'p', shareUrl: 'https://juple.test/c/p', createdAtUtc: '', permission: 'read' as const }],
    ])('while the public link is %s, 읽기 전용 is a normal choice again (no reason shown)', async (_state, share) => {
      jest.mocked(getCollectionShare).mockResolvedValue(share);
      const renderer = await renderScreen();

      await findById(renderer, 'DDDD2345');
      const viewer = renderer.root.findAll(node => node.props.testID === 'id-invite-role-viewer' && typeof node.props.onPress === 'function')[0];
      expect(viewer.props.accessibilityState.disabled).toBe(false);
      await press(renderer, 'id-invite-role-contributor');
      expect(byId(renderer, 'id-invite-role-contributor').props.accessibilityState.checked).toBe(true);
      await press(renderer, 'id-invite-role-viewer');
      expect(byId(renderer, 'id-invite-role-viewer').props.accessibilityState.checked).toBe(true);
      expect(texts(renderer)).not.toContain(i18n.t('shareSheet.belowPublicPermission'));
    });

    it('while the link is 읽기 전용, a member can still be switched to 링크 추가 가능 (and back)', async () => {
      jest.mocked(getCollectionShare).mockResolvedValue({ publicId: 'p', shareUrl: 'https://juple.test/c/p', createdAtUtc: '', permission: 'read' });
      jest.mocked(getCollectionParticipants).mockResolvedValue(readersOnly);
      jest.mocked(changeCollaboratorRole).mockResolvedValue(undefined);
      const renderer = await renderScreen();

      await press(renderer, 'member-actions-RDER2345');
      const change = renderer.root.findByType(ActionMenuDialog).props.actions
        .find((action: { label: string }) => action.label === i18n.t('shareSheet.changeToWrite'));
      await act(async () => {
        change.onPress();
      });
      expect(changeCollaboratorRole).toHaveBeenCalledWith(expect.anything(), 5, 'RDER2345', 'contributor');
    });

    it('a member can be moved to each other level - and under a 승인 후 추가 link never below it', async () => {
      jest.mocked(changeCollaboratorRole).mockResolvedValue(undefined);
      const menuLabels = (renderer: Renderer) =>
        renderer.root.findByType(ActionMenuDialog).props.actions.map((action: { label: string }) => action.label);

      // No public link: a 읽기 전용 member may become 승인 후 추가 or 링크 추가.
      jest.mocked(getCollectionParticipants).mockResolvedValue(readersOnly);
      const offRenderer = await renderScreen();
      await press(offRenderer, 'member-actions-RDER2345');
      expect(menuLabels(offRenderer)).toEqual(expect.arrayContaining([i18n.t('shareSheet.changeToSubmit'), i18n.t('shareSheet.changeToWrite')]));
      expect(menuLabels(offRenderer)).not.toContain(i18n.t('shareSheet.changeToRead'));
      const toSubmit = offRenderer.root.findByType(ActionMenuDialog).props.actions
        .find((action: { label: string }) => action.label === i18n.t('shareSheet.changeToSubmit'));
      await act(async () => {
        toSubmit.onPress();
      });
      expect(changeCollaboratorRole).toHaveBeenCalledWith(expect.anything(), 5, 'RDER2345', 'submitter');

      // A 승인 후 추가 link: a 승인 후 추가 member may only go up to 링크 추가 - never down to 읽기 전용.
      jest.mocked(getCollectionShare).mockResolvedValue({ publicId: 'p', shareUrl: 'https://juple.test/c/p', createdAtUtc: '', permission: 'submit' });
      jest.mocked(getCollectionParticipants).mockResolvedValue({
        ...readersOnly,
        participants: [owner, { jupleId: 'SBMT2345', displayName: '꼬부기', role: 'submitter' }],
      });
      const submitRenderer = await renderScreen();
      expect(texts(byId(submitRenderer, 'participant-role-SBMT2345')).join('')).toBe('승인 후 추가');
      await press(submitRenderer, 'member-actions-SBMT2345');
      expect(menuLabels(submitRenderer)).toContain(i18n.t('shareSheet.changeToWrite'));
      expect(menuLabels(submitRenderer)).not.toContain(i18n.t('shareSheet.changeToRead'));
      expect(menuLabels(submitRenderer)).not.toContain(i18n.t('shareSheet.changeToSubmit'));
    });
  });

  describe('independent cards, and person rows that never break awkwardly on a narrow screen', () => {
    const activeLink = { publicId: 'p', shareUrl: 'https://juple.test/c/p', createdAtUtc: '', permission: 'read' as const };

    it('a live public link and accepted / pending invitations show together, each in its own card', async () => {
      jest.mocked(getCollectionShare).mockResolvedValue(activeLink);
      jest.mocked(getCollectionParticipants).mockResolvedValue(withWriter);
      const renderer = await renderScreen();

      expect(isPublicOn(renderer)).toBe(true);
      expect(exists(renderer, 'share-link-action')).toBe(true);
      expect(exists(renderer, 'invite-choose-friends')).toBe(true);
      expect(texts(byId(renderer, 'share-status-tabs-members'))).toEqual([i18n.t('shareSheet.statusTabMembers', { count: 3 })]);
      expect(texts(byId(renderer, 'share-status-tabs-pending'))).toEqual([i18n.t('shareSheet.statusTabPending', { count: 1 })]);
    });

    it('using one card never hides the other: the invite batch and the typed Juple ID survive public-link changes and a refresh', async () => {
      const renderer = await renderScreen();
      await findById(renderer, 'AAAA2345');
      await press(renderer, 'id-invite-add');
      await act(async () => {
        byId(renderer, 'id-invite-input').props.onChangeText('BBBB-2345');
      });

      await press(renderer, 'share-all-users-permission-write');
      expect(exists(renderer, 'share-invite')).toBe(true);
      jest.mocked(getCollectionShare).mockResolvedValue(activeLink);
      await act(async () => {
        emitSocialPushEvent({ type: 'collectionInvitationAnswered', collectionId: 5 });
      });
      expect(isPublicOn(renderer)).toBe(true);

      expect(exists(renderer, 'draft-AAAA2345')).toBe(true);
      expect(byId(renderer, 'id-invite-input').props.value).toBe('BBBB-2345');
    });

    /** The lines of a batch row: the host View's own children (the name line, then what is below it). */
    const linesOf = (renderer: Renderer, testID: string) => {
      const host = renderer.root.findAll(node => typeof node.type === 'string' && node.props.testID === testID)[0];
      return host.children.filter(child => typeof child !== 'string') as ReactTestRenderer.ReactTestInstance[];
    };

    /** Every node of the row with a testID, in render order. */
    const idsIn = (node: ReactTestRenderer.ReactTestInstance) =>
      node.findAll(child => typeof child.type === 'string' && typeof child.props.testID === 'string').map(child => String(child.props.testID));

    it.each([
      ['narrow (320dp)', { width: 320, height: 640, scale: 2, fontScale: 1 }],
      ['wide', { width: 580, height: 900, scale: 2, fontScale: 1 }],
    ])('%s: a person to invite is who and X on one line, then 권한 over their own full-width choice', async (_label, window) => {
      mockWindow.current = window;
      const renderer = await renderScreen();
      await findById(renderer, 'AAAA2345');
      await press(renderer, 'id-invite-add');

      const [firstLine, secondLine] = linesOf(renderer, 'draft-AAAA2345');
      expect(idsIn(firstLine)).toContain('draft-remove-AAAA2345');
      expect(idsIn(firstLine).some(id => id.startsWith('draft-role-'))).toBe(false);
      expect(secondLine.props.testID).toBe('draft-permission-AAAA2345');
      expect(texts(secondLine)).toEqual(['권한', i18n.t('shareSheet.permissionRead'), i18n.t('shareSheet.permissionSubmit'), i18n.t('shareSheet.permissionWrite')]);
      expect(idsIn(secondLine)).toEqual(expect.arrayContaining(['draft-role-AAAA2345-viewer', 'draft-role-AAAA2345-submitter', 'draft-role-AAAA2345-contributor']));
      // Full width: both options share the line equally.
      const option = renderer.root.find(node => typeof node.type === 'string' && node.props.testID === 'draft-role-AAAA2345-viewer');
      expect(StyleSheet.flatten(option.props.style)).toEqual(expect.objectContaining({ flexBasis: 0, flexGrow: 1 }));
    });

    it('two people to invite stay compact: 8dp around each, 6dp between who and 권한', async () => {
      jest.mocked(getFriends).mockResolvedValue({ items: [friend('FRND2345', '피카츄'), friend('FRNE2345', '파이리')], nextCursor: null });
      const renderer = await renderScreen();
      await pickFriends(renderer, ['FRND2345', 'FRNE2345']);

      for (const jupleId of ['FRND2345', 'FRNE2345']) {
        const row = renderer.root.find(node => typeof node.type === 'string' && node.props.testID === `draft-${jupleId}`);
        expect(StyleSheet.flatten(row.props.style)).toEqual(expect.objectContaining({ gap: 6, paddingVertical: 8 }));
        const label = renderer.root.find(node => typeof node.type === 'string' && node.props.testID === `draft-permission-${jupleId}`).findAllByType(Text)[0];
        expect(StyleSheet.flatten(label.props.style)).toEqual(expect.objectContaining({ fontSize: 12, color: colors.textSecondary }));
      }
    });

    it('a large font scale needs more room before the one-line layout is used', async () => {
      mockWindow.current = { width: 580, height: 900, scale: 2, fontScale: 2 };
      const renderer = await renderScreen();
      await findById(renderer, 'AAAA2345');
      await press(renderer, 'id-invite-add');

      const [firstLine] = linesOf(renderer, 'draft-AAAA2345');
      expect(idsIn(firstLine).some(id => id.startsWith('draft-role-'))).toBe(false);
    });
  });

  describe('공유 중인 사용자 / 초대 대기 - compact rows, a role badge, actions behind "⋯"', () => {
    async function chooseFromMenu(renderer: Renderer, rowActionsTestID: string, label: string) {
      if (rowActionsTestID.startsWith('pending-') && !exists(renderer, rowActionsTestID)) {
        await press(renderer, 'share-status-tabs-pending');
      }
      await press(renderer, rowActionsTestID);
      const menu = renderer.root.findByType(ActionMenuDialog);
      expect(menu.props.visible).toBe(true);
      const action = menu.props.actions.find((entry: { label: string }) => entry.label === label);
      expect(action).toBeTruthy();
      await act(async () => {
        action.onPress();
      });
    }

    const badgeText = (renderer: Renderer, testID: string) => texts(byId(renderer, testID)).join('');

    it('lists the Owner first (나, crown, 소유자 badge, no menu), then 쓰기, then 읽기 - each with a role badge', async () => {
      jest.mocked(getCollectionParticipants).mockResolvedValue({
        ...withWriter,
        participants: [withWriter.participants[1], owner, withWriter.participants[2]],
      });
      const renderer = await renderScreen();

      const rows = renderer.root.findAll(node => typeof node.type === 'string' && /^participant-[A-Z0-9]+$/.test(String(node.props.testID ?? '')));
      expect(rows.map(row => row.props.testID)).toEqual(['participant-WNER2345', 'participant-WRTR2345', 'participant-RDER2345']);
      expect(texts(byId(renderer, 'share-status-tabs-members'))).toEqual([i18n.t('shareSheet.statusTabMembers', { count: 3 })]);

      const ownerRow = byId(renderer, 'participant-WNER2345');
      expect(ownerRow.findAllByType(CrownIcon)).toHaveLength(1);
      expect(texts(ownerRow)).toContain(i18n.t('collections.participantMe', { name: '쥬플리' }));
      expect(badgeText(renderer, 'participant-role-WNER2345')).toBe(i18n.t('collections.roleOwner'));
      expect(badgeText(renderer, 'participant-role-WRTR2345')).toBe(i18n.t('shareSheet.permissionWrite'));
      expect(badgeText(renderer, 'participant-role-RDER2345')).toBe(i18n.t('shareSheet.permissionRead'));
      expect(exists(renderer, 'member-actions-WNER2345')).toBe(false);
      // No inline toggles on accepted members - the rows stay short.
      expect(renderer.root.findAll(node => String(node.props.testID ?? '').startsWith('member-role-'))).toHaveLength(0);
    });

    it('shows each person avatar (their photo from the participant response, else the fallback) before the name - no extra request', async () => {
      jest.mocked(getCollectionParticipants).mockResolvedValue({
        ...withWriter,
        participants: [
          { ...owner, profileImageUrl: 'https://blob.example.test/p/WNER2345.jpg?sig=1', profileImageVersion: 'v1' },
          withWriter.participants[1],
          withWriter.participants[2],
        ],
      });
      const renderer = await renderScreen();

      const ownerRow = byId(renderer, 'participant-WNER2345');
      const ownerAvatar = ownerRow.findByType(UserAvatar);
      expect(ownerAvatar.props).toMatchObject({ jupleId: 'WNER2345', imageUrl: 'https://blob.example.test/p/WNER2345.jpg?sig=1', imageVersion: 'v1', size: 32 });
      // A member without a photo still gets the (initial / glyph) fallback avatar - never an empty slot.
      const writerRow = byId(renderer, 'participant-WRTR2345');
      expect(writerRow.findAllByType(UserAvatar)).toHaveLength(1);
      expect(writerRow.findByType(UserAvatar).props.imageUrl ?? null).toBeNull();
      // The list came from the one participants request.
      expect(getCollectionParticipants).toHaveBeenCalledTimes(1);
    });

    describe('공유 상태 - List / Grid', () => {
      beforeEach(() => mockPrefs.clear());
      const statusToggle = (renderer: Renderer) => byId(renderer, 'share-status').findByType(ViewModeToggle);
      const setMode = async (renderer: Renderer, mode: 'list' | 'grid') => {
        await act(async () => {
          statusToggle(renderer).props.onChange(mode);
        });
      };

      it('the List/Grid switch sits on the 공유 상태 title line, at the far end; List is the default', async () => {
        jest.mocked(getCollectionParticipants).mockResolvedValue(withWriter);
        const renderer = await renderScreen();

        const toggle = statusToggle(renderer);
        const headerRow = toggle.parent!;
        const children = headerRow.children as ReactTestRenderer.ReactTestInstance[];
        expect(children[children.length - 1] === toggle).toBe(true);
        expect(headerRow.findAll(node => node.type === Text && node.props.accessibilityRole === 'header' && node.props.children === '공유 상태').length).toBe(1);
        expect(exists(renderer, 'share-members')).toBe(true);
        expect(exists(renderer, 'share-members-grid')).toBe(false);
      });

      it('Grid shows every member as an avatar tile (photo or fallback) with name and role, and keeps the management action on the tile', async () => {
        jest.mocked(getCollectionParticipants).mockResolvedValue({
          ...withWriter,
          participants: [{ ...owner, profileImageUrl: 'https://blob.example.test/p/WNER2345.jpg?sig=1', profileImageVersion: 'v1' }, withWriter.participants[1], withWriter.participants[2]],
        });
        const renderer = await renderScreen();
        await setMode(renderer, 'grid');

        expect(exists(renderer, 'share-members')).toBe(false);
        const grid = byId(renderer, 'share-members-grid');
        expect(grid.findAllByType(UserAvatar)).toHaveLength(3);
        expect(grid.findAllByType(UserAvatar)[0].props.imageUrl).toBe('https://blob.example.test/p/WNER2345.jpg?sig=1');
        expect(grid.findAllByType(UserAvatar)[1].props.imageUrl ?? null).toBeNull();
        expect(texts(grid)).toEqual(expect.arrayContaining(['피카츄', '파이리', i18n.t('collections.roleOwner')]));
        expect(grid.findAllByType(CrownIcon)).toHaveLength(1);
        // The Owner own tile is not a button; a member tile is - and it opens the same menu as the List "..." button.
        expect(grid.findAll(node => node.props.testID === 'participant-WNER2345' && typeof node.props.onPress === 'function')).toHaveLength(0);
        await press(renderer, 'participant-RDER2345');
        const menu = renderer.root.findByType(ActionMenuDialog);
        expect(menu.props.visible).toBe(true);
        expect(menu.props.actions.map((action: { label: string }) => action.label)).toEqual(expect.arrayContaining([i18n.t('shareSheet.changeToWrite')]));
      });

      it('Grid also covers 초대 대기 (tile = the same cancel / role menu) and saves the choice', async () => {
        jest.mocked(getCollectionParticipants).mockResolvedValue(withWriter);
        const renderer = await renderScreen();
        await setMode(renderer, 'grid');
        expect(mockPrefs.get('juple.participantViewMode')).toBe('grid');

        await press(renderer, 'share-status-tabs-pending');
        const grid = byId(renderer, 'share-pending-grid');
        expect(texts(grid)).toEqual(expect.arrayContaining(['이상해씨']));
        await press(renderer, 'pending-9');
        expect(renderer.root.findByType(ActionMenuDialog).props.visible).toBe(true);
      });

      it('restores a saved Grid choice on the next visit', async () => {
        mockPrefs.set('juple.participantViewMode', 'grid');
        jest.mocked(getCollectionParticipants).mockResolvedValue(withWriter);
        const renderer = await renderScreen();

        expect(exists(renderer, 'share-members-grid')).toBe(true);
      });
    });

    it('the "⋯" menu switches a member between 읽기 and 쓰기 in both directions', async () => {
      jest.mocked(getCollectionParticipants).mockResolvedValue(withWriter);
      const renderer = await renderScreen();

      await chooseFromMenu(renderer, 'member-actions-RDER2345', i18n.t('shareSheet.changeToWrite'));
      expect(changeCollaboratorRole).toHaveBeenCalledWith(expect.anything(), 5, 'RDER2345', 'contributor');
      await chooseFromMenu(renderer, 'member-actions-WRTR2345', i18n.t('shareSheet.changeToRead'));
      expect(changeCollaboratorRole).toHaveBeenCalledWith(expect.anything(), 5, 'WRTR2345', 'viewer');
      expect(getCollectionParticipants).toHaveBeenCalledTimes(3);
    });

    it('shows pending invitations with their badge and 수락 대기; the menu changes the role and cancels', async () => {
      jest.mocked(getCollectionParticipants).mockResolvedValue(withWriter);
      const renderer = await renderScreen();

      await press(renderer, 'share-status-tabs-pending');
      expect(exists(renderer, 'share-members')).toBe(false);
      const row = texts(byId(renderer, 'pending-9')).join(' ');
      expect(row).toContain('이상해씨');
      expect(row).toContain('PNDW-R234');
      expect(row).toContain(i18n.t('shareSheet.pendingStatus'));
      expect(badgeText(renderer, 'pending-role-9')).toBe(i18n.t('shareSheet.permissionWrite'));

      await chooseFromMenu(renderer, 'pending-actions-9', i18n.t('shareSheet.changeToRead'));
      expect(changeInvitationRole).toHaveBeenCalledWith(expect.anything(), 5, 9, 'viewer');

      await chooseFromMenu(renderer, 'pending-actions-9', i18n.t('shareSheet.cancelInvitation'));
      expect(revokeCollectionInvitation).toHaveBeenCalledWith(expect.anything(), 5, 9);
    });

    it('while the public link is 링크 추가 가능, the menu offers no lower permission - nothing is sent or switched off', async () => {
      jest.mocked(getCollectionShare).mockResolvedValue({ publicId: 'p', shareUrl: 'https://juple.test/c/p', createdAtUtc: '', permission: 'write' });
      jest.mocked(getCollectionParticipants).mockResolvedValue({ ...withWriter, participants: [owner, withWriter.participants[2]] });
      const renderer = await renderScreen();

      await press(renderer, 'member-actions-WRTR2345');
      const labels = renderer.root.findByType(ActionMenuDialog).props.actions.map((action: { label: string }) => action.label);
      expect(labels).not.toContain(i18n.t('shareSheet.changeToRead'));
      expect(labels).toEqual([i18n.t('shareSheet.removeMember')]);

      expect(changeCollaboratorRole).not.toHaveBeenCalled();
      expect(changeInvitationRole).not.toHaveBeenCalled();
      expect(revokeCollectionShare).not.toHaveBeenCalled();
    });

    it('an invitee answering moves them from 초대 대기 to 공유 중 without leaving the screen', async () => {
      jest.mocked(getCollectionParticipants).mockResolvedValue(readersOnly);
      const renderer = await renderScreen();
      await press(renderer, 'share-status-tabs-pending');
      expect(exists(renderer, 'pending-8')).toBe(true);

      const accepted = readersOnly.pendingInvitations[0];
      jest.mocked(getCollectionParticipants).mockResolvedValue({
        ...readersOnly,
        participants: [...readersOnly.participants, { jupleId: accepted.jupleId, displayName: accepted.displayName ?? null, role: "viewer" }],
        pendingInvitations: [],
      });
      await act(async () => {
        emitSocialPushEvent({ type: 'collectionInvitationAnswered', collectionId: 5 });
        await new Promise<void>(resolve => setTimeout(resolve, 0));
      });

      expect(exists(renderer, 'pending-8')).toBe(false);
      await press(renderer, 'share-status-tabs-members');
      expect(exists(renderer, `participant-${accepted.jupleId}`)).toBe(true);
    });

    it('공개 링크 공유, 친구 초대 and 공유 상태 are separately outlined cards with room between them', async () => {
      const renderer = await renderScreen();
      const hostById = (testID: string) => renderer.root.find(node => typeof node.type === 'string' && node.props.testID === testID);
      const sections = ['share-all-users', 'share-invite', 'share-status'].map(testID => StyleSheet.flatten(hostById(testID).props.style));
      for (const section of sections) {
        expect(section).toEqual(expect.objectContaining({ borderWidth: 1, borderColor: colors.inputBorder, borderRadius: radii.lg }));
        // Compact: 12dp inside top/bottom, 14dp at the sides, 10dp to the next card.
        expect(section).toEqual(expect.objectContaining({ paddingVertical: 12, paddingHorizontal: 14, marginBottom: 10 }));
      }
      // The public link's permission sits under its own 권한 label, inside its card.
      expect(texts(hostById('share-all-users'))).toContain('권한');
      expect(hostById('share-all-users').findAll(node => node.props.testID === 'share-all-users-permission').length).toBeGreaterThan(0);
      expect(hostById('share-all-users-permission').props.accessibilityLabel).toBe('권한');
      expect(hostById('share-all-users-permission').props.accessibilityRole).toBe('radiogroup');
    });

    it('choices are neutral (raised white, strong text - never brand blue); only actions are blue; everything stays 44dp to touch', async () => {
      jest.mocked(getFriends).mockResolvedValue({ items: [friend('FRND2345', '피카츄')], nextCursor: null });
      const renderer = await renderScreen();
      await pickFriends(renderer, ['FRND2345']);
      const hostById = (testID: string) => renderer.root.find(node => typeof node.type === 'string' && node.props.testID === testID);
      const labelStyle = (testID: string) => StyleSheet.flatten(hostById(testID).findByType(Text).props.style);

      for (const selected of ['share-all-users-permission-read', 'share-invite-tabs-friends', 'draft-role-FRND2345-viewer']) {
        const style = StyleSheet.flatten(hostById(selected).props.style);
        expect(style.backgroundColor).toBe(colors.surface);
        expect(style.borderColor).not.toBe(colors.brand);
        expect(labelStyle(selected).color).toBe(colors.textPrimary);
        // 38dp to look at; hitSlop 3 above and below keeps the touch target at 44dp.
        expect(style.minHeight).toBe(38);
        const pressableNode = renderer.root.findAll(node => node.props.testID === selected && node.props.hitSlop !== undefined)[0];
        expect(pressableNode.props.hitSlop).toBe(3);
      }
      for (const unselected of ['share-all-users-permission-write', 'share-invite-tabs-id', 'draft-role-FRND2345-contributor']) {
        const style = StyleSheet.flatten(hostById(unselected).props.style);
        expect(style.backgroundColor).toBeUndefined();
        expect(labelStyle(unselected).color).toBe(colors.textSecondary);
      }
      // The actions stay the brand's blue, at the touch-target height.
      for (const action of ['invite-send']) {
        const style = StyleSheet.flatten(hostById(action).props.style);
        expect(style.backgroundColor).toBe(colors.brand);
        expect(style.minHeight).toBeGreaterThanOrEqual(44);
      }
    });

    it('keeps the Juple ID field above the keyboard', async () => {
      const renderer = await renderScreen();
      const avoiding = renderer.root.findByType(KeyboardAvoidingView);
      expect(avoiding.props.behavior).toBe('padding');
      await press(renderer, 'share-invite-tabs-id');
      expect(typeof byId(renderer, 'id-invite-input').props.onFocus).toBe('function');
    });

    it("the server's own conflict on a role change is shown as the reason", async () => {
      jest.mocked(getCollectionParticipants).mockResolvedValue(readersOnly);
      jest.mocked(changeCollaboratorRole).mockRejectedValue(new ApiError('conflict', 409, 'publicShareActive'));
      const renderer = await renderScreen();

      await chooseFromMenu(renderer, 'member-actions-RDER2345', i18n.t('shareSheet.changeToWrite'));
      expect(texts(byId(renderer, 'share-action-error'))).toContain(i18n.t('shareSheet.belowPublicPermission'));
    });

    it('removes a member only after confirming', async () => {
      jest.mocked(getCollectionParticipants).mockResolvedValue(withWriter);
      jest.mocked(removeCollaborator).mockResolvedValue(undefined);
      const renderer = await renderScreen();

      await chooseFromMenu(renderer, 'member-actions-WRTR2345', i18n.t('shareSheet.removeMember'));
      expect(removeCollaborator).not.toHaveBeenCalled();

      const confirm = renderer.root.findAllByType(ConfirmDialog).find(node => node.props.title === i18n.t('collaboration.removeConfirmTitle'))!;
      expect(confirm.props.visible).toBe(true);
      await act(async () => {
        confirm.props.onConfirm();
      });
      expect(removeCollaborator).toHaveBeenCalledWith(expect.anything(), 5, 'WRTR2345');
    });
  });

  describe('still protected by the old lock password (legacy) - no new sharing until the Owner moves on', () => {
    const legacy = { mode: 'legacyCommonLock', isEnabled: true, updatedAtUtc: null } as const;
    const off = { mode: 'none', isEnabled: false, updatedAtUtc: null } as const;
    const own = { mode: 'perCollection', isEnabled: true, updatedAtUtc: '2026-09-29T00:00:00Z' } as const;
    const notice = () => i18n.t('collections.sharePasswordLegacyNotice');

    beforeEach(() => {
      jest.mocked(getFriends).mockResolvedValue({ items: [friend('FRND2345', '피카츄')], nextCursor: null });
    });

    afterEach(() => {
      jest.mocked(getSharePasswordStatus).mockResolvedValue(off);
    });

    async function expectNewSharingHeldBack(renderer: Renderer, heldBack: boolean) {
      await pickFriends(renderer, ['FRND2345']);
      expect(exists(renderer, 'share-invite-migration-required')).toBe(heldBack);
      expect(byId(renderer, 'invite-send').props.accessibilityState.disabled).toBe(heldBack);
      expect(exists(renderer, 'share-public-migration-required')).toBe(heldBack);
      expect(publicToggle(renderer).props.disabled).toBe(heldBack);
    }

    it('says why, and holds back both a new invitation and a new link', async () => {
      jest.mocked(getSharePasswordStatus).mockResolvedValue(legacy);
      const renderer = await renderScreen();

      await expectNewSharingHeldBack(renderer, true);
      expect(texts(byId(renderer, 'share-public-migration-required'))).toEqual([notice()]);
      expect(notice()).toBe('이 컬렉션은 기존 잠금 비밀번호를 공유 보호에 사용 중이에요. 새로운 공유를 시작하려면 접근 비밀번호를 새로 설정하거나 접근 비밀번호 보호를 해제해 주세요.');
      expect(enableCollectionShare).not.toHaveBeenCalled();
      expect(inviteCollaborator).not.toHaveBeenCalled();
    });

    it('keeps the link it already had - that is not a new one', async () => {
      jest.mocked(getSharePasswordStatus).mockResolvedValue(legacy);
      jest.mocked(getCollectionShare).mockResolvedValue({ publicId: 'p', shareUrl: 'https://juple.test/c/p', createdAtUtc: '', permission: 'read' });
      const renderer = await renderScreen();

      expect(isPublicOn(renderer)).toBe(true);
      expect(exists(renderer, 'share-link-action')).toBe(true);
      expect(exists(renderer, 'share-public-migration-required')).toBe(false);
    });

    it('a share password of its own lets new sharing start', async () => {
      jest.mocked(getSharePasswordStatus).mockResolvedValue(legacy);
      jest.mocked(setSharePassword).mockResolvedValue(own);
      const renderer = await renderScreen();

      await press(renderer, 'share-password-set-new');
      await act(async () => {
        byId(renderer, 'share-password-input').props.onChangeText('trip-2026');
      });
      await press(renderer, 'share-password-submit');

      expect(setSharePassword).toHaveBeenCalledWith(expect.anything(), 5, 'trip-2026');
      await expectNewSharingHeldBack(renderer, false);
    });

    it('switching the protection off (the switch - there is no separate 보호 해제 button) lets new sharing start', async () => {
      jest.mocked(getSharePasswordStatus).mockResolvedValue(legacy);
      jest.mocked(removeSharePassword).mockResolvedValue(off);
      const renderer = await renderScreen();

      expect(exists(renderer, 'share-password-remove')).toBe(false);
      await act(async () => {
        byId(renderer, 'share-password-toggle').props.onValueChange(false);
      });
      const confirmDialog = renderer.root.findAllByType(Modal).find(modal => modal.props.visible)!;
      await act(async () => {
        confirmDialog.findAll(node => node.props.accessibilityLabel === i18n.t('collections.sharePasswordRemove'))[0].props.onPress();
      });

      expect(removeSharePassword).toHaveBeenCalledWith(expect.anything(), 5);
      await expectNewSharingHeldBack(renderer, false);
    });

    it('the server\'s own refusal (sharePasswordMigrationRequired) reads the same', async () => {
      jest.mocked(inviteCollaborator).mockRejectedValue(new ApiError('conflict', 409, 'sharePasswordMigrationRequired'));
      jest.mocked(enableCollectionShare).mockRejectedValue(new ApiError('conflict', 409, 'sharePasswordMigrationRequired'));
      const renderer = await renderScreen();

      await pickFriends(renderer, ['FRND2345']);
      await press(renderer, 'invite-send');
      expect(texts(byId(renderer, 'draft-error-FRND2345'))).toEqual([notice()]);

      await turnPublic(renderer, true);
      expect(texts(renderer)).toContain(notice());
    });
  });

  it('a non-owner reaching this screen sees an owner-only message, not member data', async () => {
    jest.mocked(getCollectionShare).mockRejectedValue(new ApiError('forbidden', 403, 'collectionForbidden'));
    const renderer = await renderScreen();

    expect(texts(renderer)).toContain(i18n.t('collaboration.ownerOnly'));
    expect(exists(renderer, 'share-unified')).toBe(false);
  });
});
