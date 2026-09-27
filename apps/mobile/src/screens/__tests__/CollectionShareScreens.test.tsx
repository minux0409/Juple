import ReactTestRenderer, { act } from 'react-test-renderer';
import { Text } from 'react-native';
import i18n from '../../i18n';
import { ApiError } from '../../api/ApiError';
import { CollectionShareScreen, MAX_INVITE_ROWS } from '../CollectionShareScreen';
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
import { ActionMenuDialog } from '../../components/ActionMenuDialog';
import { ConfirmDialog } from '../../components/ConfirmDialog';
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

beforeAll(async () => {
  await i18n.changeLanguage('ko');
});

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
      renderer = ReactTestRenderer.create(<CollectionShareScreen navigation={{} as never} route={route} />);
    });
    return renderer;
  }

  async function press(renderer: Renderer, testID: string) {
    await act(async () => {
      await byId(renderer, testID).props.onPress();
    });
  }

  /** The ID tab of 초대하기 (친구 is the default tab). */
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

  afterEach(() => jest.clearAllMocks());

  it('is one screen of three areas - 모든 사용자, 초대하기 [친구|ID], 공유 상태 [공유 중|초대 대기] - and opening it creates nothing', async () => {
    jest.mocked(getCollectionParticipants).mockResolvedValue(withWriter);
    const renderer = await renderScreen();

    for (const area of ['share-all-users', 'share-invite', 'share-status']) {
      expect(exists(renderer, area)).toBe(true);
    }
    // Only the two in-card tab bars; no 일반 공유 / 공동작업 split and none of the old wording.
    const tabs = renderer.root.findAll(node => typeof node.type === 'string' && node.props.accessibilityRole === 'tab');
    expect(tabs.map(tab => tab.props.testID)).toEqual([
      'share-invite-tabs-friends', 'share-invite-tabs-id', 'share-status-tabs-members', 'share-status-tabs-pending',
    ]);
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
    it('공유 시작 with 읽기 creates a read link, then offers 링크 공유 and 공유 중지 (after confirming)', async () => {
      jest.mocked(enableCollectionShare).mockResolvedValue({ publicId: 'p', shareUrl: 'https://juple.test/c/p', createdAtUtc: '', permission: 'read' });
      const renderer = await renderScreen();

      expect(byId(renderer, 'share-all-users-permission-read').props.accessibilityState.checked).toBe(true);
      expect(texts(byId(renderer, 'share-all-users-description'))).toEqual([i18n.t('shareSheet.allUsersDescription')]);
      await press(renderer, 'share-create-link');
      expect(enableCollectionShare).toHaveBeenCalledWith(expect.anything(), 5, 'read');
      expect(byId(renderer, 'share-link').props.children).toBe('https://juple.test/c/p');

      await press(renderer, 'share-link-action');
      expect(shareItem).toHaveBeenCalledWith('https://juple.test/c/p', 'Trip');

      await press(renderer, 'share-stop');
      expect(revokeCollectionShare).not.toHaveBeenCalled();
    });

    it('작성 chosen before starting changes the description and creates a writable link', async () => {
      jest.mocked(enableCollectionShare).mockResolvedValue({ publicId: 'p', shareUrl: 'https://juple.test/c/p', createdAtUtc: '', permission: 'write' });
      const renderer = await renderScreen();

      await press(renderer, 'share-all-users-permission-write');
      expect(setCollectionSharePermission).not.toHaveBeenCalled();
      expect(texts(byId(renderer, 'share-all-users-description'))).toEqual([i18n.t('shareSheet.allUsersWriteDescription')]);
      await press(renderer, 'share-create-link');
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
      expect(byId(renderer, 'share-create-link').props.disabled).toBe(false);
    });

    it('any 쓰기 member or pending 쓰기 invitation blocks it, with the reason - nothing is changed automatically', async () => {
      jest.mocked(getCollectionParticipants).mockResolvedValue({ ...withWriter, participants: [owner, withWriter.participants[1]] });
      let renderer = await renderScreen();
      expect(byId(renderer, 'share-create-link').props.disabled).toBe(true);
      expect(texts(byId(renderer, 'share-public-blocked'))).toContain(i18n.t('collections.publicShareBlockedByCollaboration'));

      jest.mocked(getCollectionParticipants).mockResolvedValue({ ...withWriter, pendingInvitations: [] });
      renderer = await renderScreen();
      expect(byId(renderer, 'share-create-link').props.disabled).toBe(true);
      await press(renderer, 'share-create-link');
      expect(enableCollectionShare).not.toHaveBeenCalled();
      expect(changeCollaboratorRole).not.toHaveBeenCalled();
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
      expect(texts(renderer)).toContain(i18n.t('shareSheet.invitationsSent', { count: 2 }));
      expect(exists(renderer, 'share-invite-list')).toBe(false);
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

    it('"+" adds one person at a time and clears the field, so several Juple IDs collect in one batch', async () => {
      const renderer = await renderScreen();
      for (const jupleId of ['AAAA2345', 'BBBB2345', 'CCCC2345']) {
        await findById(renderer, jupleId);
        expect(byId(renderer, 'id-invite-add').props.accessibilityLabel).toBe(i18n.t('shareSheet.addToInviteList'));
        await press(renderer, 'id-invite-add');
        expect(byId(renderer, 'id-invite-input').props.value).toBe('');
      }
      await press(renderer, 'draft-role-BBBB2345-contributor');

      expect(texts(byId(renderer, 'share-invite-list-count'))).toEqual([`3/${MAX_INVITE_ROWS}`]);
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

    it(`holds at most ${MAX_INVITE_ROWS} people in one batch`, async () => {
      jest.mocked(getFriends).mockResolvedValue({
        items: Array.from({ length: MAX_INVITE_ROWS + 2 }, (_, index) => friend(`F${String(index).padStart(3, '0')}2345`, null)),
        nextCursor: null,
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
      expect(draftRows).toHaveLength(MAX_INVITE_ROWS);
      expect(byId(renderer, 'invite-choose-friends').props.disabled).toBe(true);
    });

    it('while the public link is on, 쓰기 cannot be chosen for anyone in the batch - the reason is shown instead', async () => {
      jest.mocked(getCollectionShare).mockResolvedValue({ publicId: 'p', shareUrl: 'https://juple.test/c/p', createdAtUtc: '' });
      const renderer = await renderScreen();
      await findById(renderer, 'CCCC2345');
      await press(renderer, 'id-invite-role-contributor');

      expect(byId(renderer, 'id-invite-role-viewer').props.accessibilityState.checked).toBe(true);
      expect(texts(byId(renderer, 'share-action-error'))).toContain(i18n.t('collaboration.blockedByPublicShare'));
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

    it('while the public link is on, making someone 쓰기 is refused on the spot - nothing is sent or switched off', async () => {
      jest.mocked(getCollectionShare).mockResolvedValue({ publicId: 'p', shareUrl: 'https://juple.test/c/p', createdAtUtc: '' });
      jest.mocked(getCollectionParticipants).mockResolvedValue(readersOnly);
      const renderer = await renderScreen();

      await chooseFromMenu(renderer, 'member-actions-RDER2345', i18n.t('shareSheet.changeToWrite'));
      await chooseFromMenu(renderer, 'pending-actions-8', i18n.t('shareSheet.changeToWrite'));

      expect(changeCollaboratorRole).not.toHaveBeenCalled();
      expect(changeInvitationRole).not.toHaveBeenCalled();
      expect(revokeCollectionShare).not.toHaveBeenCalled();
      expect(texts(byId(renderer, 'share-action-error'))).toContain(i18n.t('collaboration.blockedByPublicShare'));
    });

    it("the server's own conflict on a role change is shown as the reason", async () => {
      jest.mocked(getCollectionParticipants).mockResolvedValue(readersOnly);
      jest.mocked(changeCollaboratorRole).mockRejectedValue(new ApiError('conflict', 409, 'publicShareActive'));
      const renderer = await renderScreen();

      await chooseFromMenu(renderer, 'member-actions-RDER2345', i18n.t('shareSheet.changeToWrite'));
      expect(texts(byId(renderer, 'share-action-error'))).toContain(i18n.t('collaboration.blockedByPublicShare'));
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

  it('a non-owner reaching this screen sees an owner-only message, not member data', async () => {
    jest.mocked(getCollectionShare).mockRejectedValue(new ApiError('forbidden', 403, 'collectionForbidden'));
    const renderer = await renderScreen();

    expect(texts(renderer)).toContain(i18n.t('collaboration.ownerOnly'));
    expect(exists(renderer, 'share-unified')).toBe(false);
  });
});
