import ReactTestRenderer, { act } from 'react-test-renderer';
import { ActivityIndicator, Animated, Modal, Text } from 'react-native';
import i18n from '../../i18n';
import { CollectionParticipantsSheet } from '../CollectionParticipantsSheet';
import { formatParticipantSummary } from '../participantSummary';
import { CrownIcon } from '../../icons/CrownIcon';
import { ViewModeToggle } from '../../components/ViewModeToggle';
import { UserAvatar } from '../../components/UserAvatar';
import { StyleSheet } from 'react-native';
import {
  getCollectionParticipants,
  participantRoleLabelKey,
  removeCollaborator,
  revokeCollectionInvitation,
  type CollectionParticipants,
} from '../api/collaborationApi';

const mockPrefs = new Map<string, string>();
jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(async (key: string) => mockPrefs.get(key) ?? null),
    setItem: jest.fn(async (key: string, value: string) => {
      mockPrefs.set(key, value);
    }),
  },
}));

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
beforeEach(() => mockPrefs.clear());

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
  it('opens with the list the screen already holds - its first frame has the final rows, no spinner placeholder that later grows', () => {
    // The request never resolves: whatever is shown is the very first frame.
    jest.mocked(getCollectionParticipants).mockReturnValue(new Promise(() => undefined));
    let renderer!: ReactTestRenderer.ReactTestRenderer;
    act(() => {
      renderer = ReactTestRenderer.create(
        <CollectionParticipantsSheet
          authenticatedRequest={jest.fn() as never}
          collectionId={5}
          initialData={{ participants: [{ jupleId: 'WNER2345', displayName: '피카츄', role: 'owner', isMe: false }], pendingInvitations: [], canManage: false }}
          onClose={jest.fn()}
          visible
        />,
      );
    });

    expect(renderer.root.findAllByProps({ testID: 'participants-sheet-WNER2345' }).length).toBeGreaterThan(0);
    expect(renderer.root.findAllByType(ActivityIndicator)).toHaveLength(0);
  });

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

describe('CollectionParticipantsSheet - List / Grid', () => {
  const data: CollectionParticipants = {
    participants: [
      { jupleId: 'WNER2345', displayName: '피카츄', role: 'owner', isMe: false },
      { jupleId: 'CNTRB234', displayName: null, role: 'contributor', isMe: false },
    ],
    pendingInvitations: [{ invitationId: 4, jupleId: 'PNDG2345', displayName: '꼬부기', role: 'Viewer', createdAtUtc: '', expiresAtUtc: '' }],
    canManage: true,
  };

  async function renderWith(initial: CollectionParticipants) {
    jest.mocked(getCollectionParticipants).mockResolvedValue(initial);
    let renderer!: ReactTestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = ReactTestRenderer.create(
        <CollectionParticipantsSheet authenticatedRequest={jest.fn() as never} collectionId={5} initialData={initial} onClose={jest.fn()} visible />,
      );
    });
    return renderer;
  }

  it('puts the List/Grid switch on the title line, at the far end', async () => {
    const renderer = await renderWith(data);

    const toggle = renderer.root.findByType(ViewModeToggle);
    const row = toggle.parent!;
    expect(StyleSheet.flatten(row.props.style)).toMatchObject({ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' });
    const children = row.children as ReactTestRenderer.ReactTestInstance[];
    expect(children[children.length - 1] === toggle).toBe(true);
    expect(row.findAllByType(Text).some(node => node.props.children === i18n.t('collections.participantsTitle'))).toBe(true);
  });

  it('Grid uses the shared tiles (avatar with fallback, name, role, crown), keeps remove / cancel on the tiles, and saves the choice', async () => {
    const renderer = await renderWith(data);
    await act(async () => {
      renderer.root.findByType(ViewModeToggle).props.onChange('grid');
    });

    expect(mockPrefs.get('juple.participantViewMode')).toBe('grid');
    const grid = renderer.root.findByProps({ testID: 'participants-sheet-grid' });
    expect(grid.findAllByType(UserAvatar)).toHaveLength(2);
    expect(grid.findAllByType(CrownIcon)).toHaveLength(1);
    expect(grid.findAllByType(Text).map(node => node.props.children)).toEqual(expect.arrayContaining(['피카츄', 'CNTR-B234', i18n.t('collections.roleOwner')]));
    expect(grid.findAll(node => node.props.testID === 'participants-sheet-WNER2345' && typeof node.props.onPress === 'function')).toHaveLength(0);
    await act(async () => {
      grid.findAll(node => node.props.testID === 'participants-sheet-CNTRB234' && typeof node.props.onPress === 'function')[0].props.onPress();
    });
    expect(renderer.root.findAllByType(Modal).some(modal => modal.props.visible && modal.findAll(node => node.props.accessibilityLabel === i18n.t('collaboration.remove')).length > 0)).toBe(true);
    const pendingGrid = renderer.root.findByProps({ testID: 'participants-sheet-pending-grid' });
    jest.mocked(revokeCollectionInvitation).mockResolvedValue(undefined);
    await act(async () => {
      pendingGrid.findAll(node => node.props.testID === 'participants-sheet-pending-4' && typeof node.props.onPress === 'function')[0].props.onPress();
    });
    expect(revokeCollectionInvitation).toHaveBeenCalledWith(expect.anything(), 5, 4);
  });

  it('shares the preference with the Share screen: a change made by another mounted screen shows here at once', async () => {
    const renderer = await renderWith(data);
    expect(renderer.root.findAllByProps({ testID: 'participants-sheet-grid' })).toHaveLength(0);

    let other!: ReactTestRenderer.ReactTestRenderer;
    await act(async () => {
      other = ReactTestRenderer.create(
        <CollectionParticipantsSheet authenticatedRequest={jest.fn() as never} collectionId={5} initialData={data} onClose={jest.fn()} visible />,
      );
    });
    await act(async () => {
      other.root.findByType(ViewModeToggle).props.onChange('grid');
    });

    expect(renderer.root.findAllByProps({ testID: 'participants-sheet-grid' }).length).toBeGreaterThan(0);
  });

  it('the first frame is final-sized in Grid mode too (seeded list, no spinner)', async () => {
    mockPrefs.set('juple.participantViewMode', 'grid');
    jest.mocked(getCollectionParticipants).mockReturnValue(new Promise(() => undefined));
    let renderer!: ReactTestRenderer.ReactTestRenderer;
    act(() => {
      renderer = ReactTestRenderer.create(
        <CollectionParticipantsSheet authenticatedRequest={jest.fn() as never} collectionId={5} initialData={data} onClose={jest.fn()} visible />,
      );
    });
    await act(async () => undefined);
    expect(renderer.root.findAllByType(ActivityIndicator)).toHaveLength(0);
    expect(renderer.root.findAllByProps({ testID: 'participants-sheet-grid' }).length).toBeGreaterThan(0);
  });
});

describe('CollectionParticipantsSheet - first visible frames', () => {
  const data: CollectionParticipants = {
    participants: [{ jupleId: 'WNER2345', displayName: '피카츄', role: 'owner', isMe: false }],
    pendingInvitations: [],
    canManage: false,
  };
  const sheetNodes = (renderer: ReactTestRenderer.ReactTestRenderer) =>
    renderer.root.findAll(node => node.props.testID === 'participants-sheet' && typeof node.type === 'string');
  const styleOf = (node: ReactTestRenderer.ReactTestInstance) => StyleSheet.flatten(node.props.style) as { opacity: number; transform: { translateY: number }[] };

  function mount(visible = true) {
    jest.mocked(getCollectionParticipants).mockReturnValue(new Promise(() => undefined));
    const element = (isVisible: boolean) => (
      <CollectionParticipantsSheet authenticatedRequest={jest.fn() as never} collectionId={5} initialData={data} onClose={jest.fn()} visible={isVisible} />
    );
    let renderer!: ReactTestRenderer.ReactTestRenderer;
    act(() => {
      renderer = ReactTestRenderer.create(element(visible));
    });
    return { renderer, rerender: (isVisible: boolean) => act(() => renderer.update(element(isVisible))) };
  }
  const layout = (renderer: ReactTestRenderer.ReactTestRenderer, height: number) =>
    act(() => {
      sheetNodes(renderer)[0].props.onLayout({ nativeEvent: { layout: { x: 0, y: 0, width: 360, height } } });
    });

  it('the very first frame is invisible (opacity 0, backdrop included) and nothing is animating yet - no unanimated white panel', () => {
    const timing = jest.spyOn(Animated, 'timing');
    const { renderer } = mount();

    expect(styleOf(sheetNodes(renderer)[0]).opacity).toBe(0);
    const backdrop = renderer.root.findAll(node => node.props.testID === 'participants-sheet-backdrop' && typeof node.type === 'string')[0];
    expect((StyleSheet.flatten(backdrop.props.style) as { opacity: number }).opacity).toBe(0);
    expect(timing).not.toHaveBeenCalled();
    timing.mockRestore();
  });

  it('there is exactly one sheet container, already carrying the seeded participants (no placeholder sheet first)', () => {
    const { renderer } = mount();

    expect(sheetNodes(renderer)).toHaveLength(1);
    expect(renderer.root.findAllByType(ActivityIndicator)).toHaveLength(0);
    expect(renderer.root.findAllByProps({ testID: 'participants-sheet-WNER2345' }).length).toBeGreaterThan(0);
  });

  it('the single entrance starts from the sheet first layout (its real height), once - the list growing later restarts nothing', () => {
    const timing = jest.spyOn(Animated, 'timing');
    const { renderer } = mount();

    layout(renderer, 320);
    expect(timing).toHaveBeenCalledTimes(1);
    expect(timing.mock.calls[0][1]).toMatchObject({ toValue: 1, useNativeDriver: true });
    layout(renderer, 480);
    layout(renderer, 0);
    expect(timing).toHaveBeenCalledTimes(1);
    timing.mockRestore();
  });

  it('the native Modal does not animate on top of it, and covers the whole window like the other modals', () => {
    const { renderer } = mount();

    const modal = renderer.root.findByType(Modal);
    expect(modal.props).toMatchObject({ animationType: 'none', transparent: true, statusBarTranslucent: true, navigationBarTranslucent: true });
  });

  it('closing and opening again starts from the invisible state once more (no leftover shown sheet)', () => {
    const timing = jest.spyOn(Animated, 'timing');
    const { renderer, rerender } = mount();
    layout(renderer, 320);
    expect(timing).toHaveBeenCalledTimes(1);

    rerender(false);
    rerender(true);
    expect(styleOf(sheetNodes(renderer)[0]).opacity).toBe(0);
    layout(renderer, 320);
    expect(timing).toHaveBeenCalledTimes(2);
    timing.mockRestore();
  });

  it('List and Grid both render inside the same single container', async () => {
    const { renderer } = mount();
    await act(async () => {
      renderer.root.findByType(ViewModeToggle).props.onChange('grid');
    });
    expect(sheetNodes(renderer)).toHaveLength(1);
    expect(renderer.root.findAllByProps({ testID: 'participants-sheet-grid' }).length).toBeGreaterThan(0);
    await act(async () => {
      renderer.root.findByType(ViewModeToggle).props.onChange('list');
    });
    expect(sheetNodes(renderer)).toHaveLength(1);
  });
});
