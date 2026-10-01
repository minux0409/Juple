import ReactTestRenderer, { act } from 'react-test-renderer';
import { Modal, Text } from 'react-native';
import i18n from '../../i18n';
import { CollectionParticipantsSheet } from '../CollectionParticipantsSheet';
import { formatParticipantSummary } from '../participantSummary';
import { CrownIcon } from '../../icons/CrownIcon';
import {
  getCollectionParticipants,
  participantRoleLabelKey,
  removeCollaborator,
  revokeCollectionInvitation,
  type CollectionParticipants,
} from '../api/collaborationApi';

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));

jest.mock('../api/collaborationApi', () => ({
  ...jest.requireActual('../api/collaborationApi'),
  getCollectionParticipants: jest.fn(),
  removeCollaborator: jest.fn(),
  revokeCollectionInvitation: jest.fn(),
}));

beforeAll(async () => {
  await i18n.changeLanguage('ko');
});

afterEach(() => jest.clearAllMocks());

const members = [
  { jupleId: 'WNER2345', displayName: '피카츄', role: 'owner' },
  { jupleId: 'CNTRB234', displayName: null, role: 'contributor' },
] as const;

async function renderSheet(data: CollectionParticipants) {
  jest.mocked(getCollectionParticipants).mockResolvedValue(data);
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => {
    renderer = ReactTestRenderer.create(
      <CollectionParticipantsSheet authenticatedRequest={jest.fn() as never} collectionId={5} onClose={jest.fn()} visible />,
    );
  });
  return renderer;
}

describe('CollectionParticipantsSheet', () => {
  it('appears at once - no slide-up animation dragging the dim backdrop up from the bottom', async () => {
    const renderer = await renderSheet({ participants: [{ jupleId: 'WNER2345', displayName: '쥬플리', role: 'owner', isMe: true }], pendingInvitations: [], canManage: false });

    const modal = renderer.root.findByType(Modal);
    expect(modal.props.visible).toBe(true);
    expect(modal.props.animationType).toBe('none');
  });

  it('a Contributor sees everyone (name, else Juple ID) read-only - no pending invitations, no remove/cancel', async () => {
    const renderer = await renderSheet({
      participants: [...members, { jupleId: 'MEEE2345', displayName: '이상해씨', role: 'contributor', isMe: true }],
      pendingInvitations: [],
      canManage: false,
    });

    const texts = renderer.root.findAllByType(Text).map(node => node.props.children);
    expect(texts).toEqual(expect.arrayContaining(['피카츄', 'CNTR-B234', '이상해씨 (나)', i18n.t('collections.roleOwner')]));
    // The Owner's crown is the vector icon - never an emoji glyph - and only on the Owner's row.
    expect(JSON.stringify(texts)).not.toContain('👑');
    const ownerRow = renderer.root.findByProps({ testID: 'participants-sheet-WNER2345' });
    expect(ownerRow.findAllByType(CrownIcon)).toHaveLength(1);
    expect(renderer.root.findAllByType(CrownIcon)).toHaveLength(1);
    expect(renderer.root.findAll(node => String(node.props.testID).startsWith('participants-sheet-remove-'))).toHaveLength(0);
    expect(renderer.root.findAll(node => String(node.props.testID).startsWith('participants-sheet-revoke-'))).toHaveLength(0);
  });

  it('a Viewer sees the same read-only list: avatar, name, formatted Juple ID and role per person, the crown only for the Owner', async () => {
    const { UserAvatar } = require('../../components/UserAvatar');
    const renderer = await renderSheet({
      participants: [
        { jupleId: 'WNER2345', displayName: '피카츄', role: 'owner', profileImageUrl: 'https://blob.example/owner.jpg', profileImageVersion: 'v1' },
        { jupleId: 'VIEW2345', displayName: '꼬부기', role: 'viewer', isMe: true },
      ],
      pendingInvitations: [],
      canManage: false,
    });

    const ownerRow = renderer.root.findByProps({ testID: 'participants-sheet-WNER2345' });
    expect(ownerRow.findByType(UserAvatar).props).toEqual(expect.objectContaining({ imageUrl: 'https://blob.example/owner.jpg', imageVersion: 'v1' }));
    expect(renderer.root.findByProps({ testID: 'participants-sheet-id-WNER2345' }).props.children).toBe('WNER-2345');
    expect(renderer.root.findByProps({ testID: 'participants-sheet-id-VIEW2345' }).props.children).toBe('VIEW-2345');
    const texts = renderer.root.findAllByType(Text).map(node => node.props.children);
    expect(texts).toEqual(expect.arrayContaining([i18n.t('collections.roleOwner'), i18n.t(participantRoleLabelKey('viewer'))]));
    expect(renderer.root.findAllByType(CrownIcon)).toHaveLength(1);
    // Nothing to manage for a member.
    expect(renderer.root.findAll(node => String(node.props.testID).startsWith('participants-sheet-remove-'))).toHaveLength(0);
    expect(renderer.root.findAll(node => String(node.props.testID).startsWith('participants-sheet-revoke-'))).toHaveLength(0);
  });

  it('the Owner can cancel a pending invitation and remove a Contributor (after confirming)', async () => {
    const renderer = await renderSheet({
      participants: [...members],
      pendingInvitations: [{ invitationId: 9, jupleId: 'PNDNG234', displayName: null, role: 'Contributor', createdAtUtc: '', expiresAtUtc: '' }],
      canManage: true,
    });

    expect(renderer.root.findAll(node => node.props.testID === 'participants-sheet-remove-WNER2345')).toHaveLength(0);
    // The pending section says exactly what it is: invitations this Owner sent, not yet accepted.
    expect(renderer.root.findAllByType(Text).map(node => node.props.children)).toContain(i18n.t('collaboration.pendingCollaborationTitle'));
    await act(async () => {
      await renderer.root.findByProps({ testID: 'participants-sheet-revoke-9' }).props.onPress();
    });
    expect(revokeCollectionInvitation).toHaveBeenCalledWith(expect.anything(), 5, 9);

    await act(async () => {
      renderer.root.findByProps({ testID: 'participants-sheet-remove-CNTRB234' }).props.onPress();
    });
    expect(removeCollaborator).not.toHaveBeenCalled();
  });
});

describe('CollectionParticipantsSheet - roles', () => {
  it('labels a Viewer as view-only (not a collaborator), and a pending Viewer invitation too', async () => {
    const renderer = await renderSheet({
      participants: [
        { jupleId: 'WNER2345', displayName: '피카츄', role: 'owner' },
        { jupleId: 'CNTRB234', displayName: '파이리', role: 'contributor' },
        { jupleId: 'VWER2345', displayName: '꼬부기', role: 'viewer' },
      ],
      pendingInvitations: [{ invitationId: 4, jupleId: 'PNDV2345', displayName: null, role: 'Viewer', createdAtUtc: '', expiresAtUtc: '' }],
      canManage: true,
    });

    const roleOf = (testID: string) =>
      renderer.root.findByProps({ testID }).findAllByType(Text).map(node => node.props.children);
    expect(roleOf('participants-sheet-WNER2345')).toContain(i18n.t('collections.roleOwner'));
    expect(roleOf('participants-sheet-CNTRB234')).toContain(i18n.t('collections.roleContributor'));
    expect(roleOf('participants-sheet-VWER2345')).toContain(i18n.t('collections.roleViewer'));
    expect(roleOf('participants-sheet-VWER2345')).not.toContain(i18n.t('collections.roleContributor'));
    expect(roleOf('participants-sheet-pending-4')).toContain(i18n.t('collections.roleViewer'));
  });
});

describe('formatParticipantSummary', () => {
  const t = i18n.t.bind(i18n);

  it('names up to the preview (display name, else Juple ID), then 외 N명', () => {
    expect(formatParticipantSummary({ participantPreview: [...members], otherParticipantCount: 4 }, t)).toBe('피카츄 · CNTR-B234 외 2명');
    expect(formatParticipantSummary({ participantPreview: [members[0]], otherParticipantCount: 1 }, t)).toBe('피카츄');
  });

  it('is null for a Collection nobody else is in', () => {
    expect(formatParticipantSummary({ participantPreview: null, otherParticipantCount: 0 }, t)).toBeNull();
    expect(formatParticipantSummary({}, t)).toBeNull();
  });
});
