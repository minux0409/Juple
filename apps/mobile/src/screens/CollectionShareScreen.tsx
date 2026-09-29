import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useCallback, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import {
  ActivityIndicator,
  Keyboard,
  KeyboardAvoidingView,
  Pressable,
  ScrollView,
  type ScrollViewInstance,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
  type ViewInstance,
} from 'react-native';
import { ApiError } from '../api/ApiError';
import { useAuthenticatedApi } from '../api/useAuthenticatedApi';
import {
  changeCollaboratorRole,
  changeInvitationRole,
  formatJupleId,
  getCollectionParticipants,
  inviteCollaborator,
  invitationRoleOf,
  lookupJupleId,
  personLabel,
  removeCollaborator,
  revokeCollectionInvitation,
  type CollectionParticipants,
  type InvitationRole,
  type JupleIdLookupResult,
} from '../collections/api/collaborationApi';
import { OwnerCrown } from '../collections/CollectionParticipantsSheet';
import {
  enableCollectionShare,
  getCollection,
  getCollectionShare,
  revokeCollectionShare,
  setCollectionSharePermission,
  type Collection,
  type CollectionShare,
  type PublicSharePermission,
} from '../collections/api/collectionsApi';
import { isCollectionLocked } from '../collections/collectionAccess';
import { SharePasswordCard } from '../collections/SharePasswordCard';
import type { SharePasswordMode } from '../collections/api/sharePasswordApi';
import { isCollectionLockedError } from '../collections/useCollectionItems';
import { runWithConcurrency } from '../collections/runWithConcurrency';
import { FriendPickerModal, type FriendUnavailableReason } from '../friends/FriendPickerModal';
import type { Friend } from '../friends/api/friendsApi';
import { ActionMenuDialog, type ActionMenuDialogAction } from '../components/ActionMenuDialog';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { StackScreenSafeArea } from '../components/StackScreenSafeArea';
import { CloseIcon } from '../icons/CloseIcon';
import { MoreIcon } from '../icons/MoreIcon';
import { PeopleIcon } from '../icons/PeopleIcon';
import { PlusIcon } from '../icons/PlusIcon';
import { shareItem } from '../items/shareItem';
import { ensurePushPermissionOnce } from '../push/pushPermissionFlow';
import { useLiveRefresh } from '../push/useLiveRefresh';
import type { RootStackParamList } from '../navigation/RootStack';
import { categoryTilePalette, colors, ltrTextStyle, minTouchTarget, radii, spacing } from '../theme/tokens';

type Props = NativeStackScreenProps<RootStackParamList, 'CollectionShare'>;

/**
 * Invitations in flight at once. There is no batch size limit - the API takes one invitation per
 * person and has its own per-identity rate limit, so a large batch is simply sent a few at a time,
 * each person keeping their own result.
 */
export const INVITE_CONCURRENCY = 3;

/**
 * While 모든 사용자 is on, its permission is the minimum every specific person has (a server rule
 * too): under 읽기 전용 each person keeps their own choice (null - any role), under 링크 추가 가능
 * everyone is 링크 추가 가능, since a lower role would misstate what the link already lets them do.
 */
export function minimumRoleForPublicPermission(permission: PublicSharePermission): InvitationRole | null {
  return permission === 'write' ? 'contributor' : null;
}

/** A person waiting in the invitation batch - picked from friends or found by Juple ID - with their own 읽기 전용/링크 추가 가능. */
interface InviteDraft {
  readonly jupleId: string;
  readonly displayName: string | null;
  readonly role: InvitationRole;
  readonly status: 'ready' | 'sending' | 'error';
  readonly message: string | null;
}

type BadgeKind = 'owner' | InvitationRole;

type MainTab = 'public' | 'invite';

const CONTENT_MAX_WIDTH = 640;

/**
 * The width (at font scale 1) a person row needs to keep name + permission toggle + X on one line
 * with the name still readable; below it the row switches to its two-line layout.
 */
export const INLINE_PERSON_ROW_MIN_WIDTH = 380;

/** What the "⋯" menu of one row acts on: an accepted member, or a pending invitation. */
type ManagedPerson =
  | { readonly kind: 'member'; readonly jupleId: string; readonly label: string; readonly role: InvitationRole }
  | { readonly kind: 'pending'; readonly invitationId: number; readonly label: string; readonly role: InvitationRole };

/** Canonical form of a typed Juple ID for duplicate checks (the server does the real validation). */
function normalizeJupleIdInput(value: string): string {
  return value.replace(/[\s-]/g, '').toUpperCase();
}

function memberRoleOf(role: string): BadgeKind {
  return role === 'owner' ? 'owner' : role === 'contributor' ? 'contributor' : 'viewer';
}

/** Owner first, then 링크 추가 가능, then 읽기 전용 - so who can add to the Collection is visible at a glance. */
const ROLE_ORDER: Record<BadgeKind, number> = { owner: 0, contributor: 1, viewer: 2 };

function getLookupErrorMessage(error: unknown, t: TFunction): string {
  if (error instanceof ApiError) {
    if (error.kind === 'notFound') {
      return t('collaboration.lookupNotFound');
    }
    if (error.kind === 'tooManyRequests') {
      return t('collaboration.tooManyRequests');
    }
  }
  return t('collaboration.lookupFallback');
}

/** For invites, role changes, removals and revokes - every sharing action on this screen. */
function getActionErrorMessage(error: unknown, t: TFunction): string {
  if (isCollectionLockedError(error)) {
    return t('collections.lockRequiredForAction');
  }
  if (error instanceof ApiError) {
    if (error.kind === 'conflict') {
      switch (error.code) {
        case 'alreadyCollaborator':
          return t('collaboration.alreadyCollaborator');
        case 'invitationPending':
          return t('collaboration.invitationAlreadyPending');
        case 'publicShareActive':
          return t('collaboration.blockedByPublicShare');
        case 'invitationNotPending':
          return t('collaboration.invitationNoLongerValid');
        case 'sharePasswordMigrationRequired':
          return t('collections.sharePasswordLegacyNotice');
      }
    }
    if (error.kind === 'badRequest') {
      return t('collaboration.cannotInviteSelf');
    }
    if (error.kind === 'notFound') {
      return t('collaboration.lookupNotFound');
    }
    if (error.kind === 'tooManyRequests') {
      return t('collaboration.tooManyRequests');
    }
  }
  return t('collaboration.actionFallback');
}

/**
 * attemptedPermission: what the user just tried to turn 모든 사용자 into (null for stopping it). The
 * "someone is 읽기 전용, so 링크 추가 can't apply to everyone" reason is only ever shown for an attempt
 * to make it 링크 추가 가능 - the one case the server refuses it for (publicSharePermissionMismatch);
 * 읽기 전용 is the minimum and never conflicts with anyone.
 */
function getShareManagementErrorMessage(error: unknown, t: TFunction, attemptedPermission: PublicSharePermission | null): string {
  if (isCollectionLockedError(error)) {
    return t('collections.lockRequiredForAction');
  }
  if (error instanceof ApiError) {
    if (error.kind === 'unauthorized') {
      return t('errors.unauthorized');
    }
    if (error.kind === 'conflict' && error.code === 'publicSharePermissionMismatch' && attemptedPermission === 'write') {
      return t('shareSheet.permissionMismatch');
    }
    if (error.kind === 'conflict' && error.code === 'sharePasswordMigrationRequired') {
      return t('collections.sharePasswordLegacyNotice');
    }
    return t('collections.errorShareManagementFallback');
  }
  return t('item.shareError');
}

function RoleBadge({ kind, testID }: { readonly kind: BadgeKind; readonly testID?: string }) {
  const { t } = useTranslation();
  const label = kind === 'owner' ? t('collections.roleOwner') : kind === 'contributor' ? t('shareSheet.permissionWrite') : t('shareSheet.permissionRead');
  return (
    <View style={[styles.badge, badgeStyles[kind]]} testID={testID}>
      <Text numberOfLines={1} style={[styles.badgeLabel, badgeLabelStyles[kind]]}>{label}</Text>
    </View>
  );
}

interface RoleToggleProps {
  readonly value: InvitationRole;
  readonly onChange: (role: InvitationRole) => void;
  readonly disabled?: boolean;
  readonly label: string;
  readonly testID: string;
  /** Takes the full width of its line (two equal halves) - the narrow-screen layout of a person row. */
  readonly stretch?: boolean;
}

/** 읽기 전용 | 링크 추가 가능 for one person about to be invited. The wire roles (viewer/contributor) are never shown. */
function RoleToggle({ value, onChange, disabled = false, label, testID, stretch = false }: RoleToggleProps) {
  const { t } = useTranslation();
  return (
    <View accessibilityLabel={t('shareSheet.permissionA11y', { name: label })} accessibilityRole="radiogroup" style={[styles.roleToggle, stretch && styles.roleToggleStretch]}>
      {(['viewer', 'contributor'] as const).map(role => {
        const isSelected = value === role;
        return (
          <Pressable
            accessibilityRole="radio"
            accessibilityState={{ checked: isSelected, disabled }}
            disabled={disabled}
            key={role}
            onPress={() => {
              if (!isSelected) {
                onChange(role);
              }
            }}
            style={[styles.roleOption, stretch && styles.roleOptionStretch, isSelected && styles.roleOptionSelected, disabled && styles.disabled]}
            testID={`${testID}-${role}`}
          >
            <Text numberOfLines={1} style={[styles.roleOptionLabel, isSelected && styles.roleOptionLabelSelected]}>
              {role === 'viewer' ? t('shareSheet.permissionRead') : t('shareSheet.permissionWrite')}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/** Shown instead of RoleToggle while 모든 사용자 is 링크 추가 가능: nobody can be given less than that. */
function FixedRoleBadge({ testID }: { readonly testID: string }) {
  const { t } = useTranslation();
  return (
    <View style={styles.fixedRole} testID={testID}>
      <Text style={styles.fixedRoleLabel}>{t('collaboration.blockedByPublicShare')}</Text>
    </View>
  );
}

interface SegmentOption<T extends string> {
  readonly key: T;
  readonly label: string;
  /** A small "on" dot after the label - e.g. the 모든 사용자 link is active while another tab is shown. */
  readonly isActive?: boolean;
}

/**
 * One row of equal segments - the screen's two main tabs (모든 사용자 공유 | 초대하기), the inner tab
 * bars (친구 | ID, 공유 중 | 초대 대기) and the 모든 사용자 읽기 전용 | 링크 추가 가능 selector share
 * this one look; "large" is the main tabs' taller, bolder variant.
 */
function Segmented<T extends string>({
  options,
  value,
  onChange,
  kind,
  size = 'regular',
  disabled = false,
  testID,
  onReselect,
}: {
  readonly options: readonly SegmentOption<T>[];
  readonly value: T;
  readonly onChange: (key: T) => void;
  /** Tapping the segment that is already selected - by default nothing happens. */
  readonly onReselect?: (key: T) => void;
  readonly kind: 'tabs' | 'radio';
  readonly size?: 'regular' | 'large';
  readonly disabled?: boolean;
  readonly testID: string;
}) {
  const isLarge = size === 'large';
  return (
    <View accessibilityRole={kind === 'tabs' ? 'tablist' : 'radiogroup'} style={[styles.segmented, isLarge && styles.segmentedLarge]} testID={testID}>
      {options.map(option => {
        const isSelected = value === option.key;
        return (
          <Pressable
            accessibilityRole={kind === 'tabs' ? 'tab' : 'radio'}
            accessibilityState={kind === 'tabs' ? { selected: isSelected, disabled } : { checked: isSelected, disabled }}
            disabled={disabled}
            key={option.key}
            onPress={() => {
              if (!isSelected) {
                onChange(option.key);
              } else {
                onReselect?.(option.key);
              }
            }}
            style={[styles.segment, isLarge && styles.segmentLarge, isSelected && styles.segmentSelected, disabled && styles.disabled]}
            testID={`${testID}-${option.key}`}
          >
            <Text
              numberOfLines={isLarge ? 2 : 1}
              style={[styles.segmentLabel, isLarge && styles.segmentLabelLarge, isSelected && styles.segmentLabelSelected]}
            >
              {option.label}
            </Text>
            {option.isActive ? <View style={styles.segmentActiveDot} testID={`${testID}-${option.key}-active`} /> : null}
          </Pressable>
        );
      })}
    </View>
  );
}

function SectionCard({
  icon,
  title,
  count,
  children,
  testID,
}: {
  readonly icon: ReactNode;
  readonly title: string;
  readonly count?: string;
  readonly children: ReactNode;
  readonly testID: string;
}) {
  return (
    <View style={styles.card} testID={testID}>
      <View style={styles.cardHeader}>
        <View style={styles.cardIcon}>{icon}</View>
        <Text accessibilityRole="header" numberOfLines={2} style={styles.cardTitle}>{title}</Text>
        {count !== undefined ? <Text style={[styles.cardCount, ltrTextStyle]} testID={`${testID}-count`}>{count}</Text> : null}
      </View>
      {children}
    </View>
  );
}

/**
 * The one place for sharing a Collection (Owner only). Two main tabs over one panel, so it never
 * grows into a long column of cards, and the shared state below them:
 * - [모든 사용자 공유]: the public link, [읽기 전용] (anyone with the link views, signed in or not)
 *   or [링크 추가 가능] (additionally, holders SIGNED IN to Juple may add their own links - never
 *   anonymously). A dot on the tab tells the link is on while the other tab is shown.
 * - [초대하기]: [친구] | [ID] tabs feeding one batch of any size; each person gets 읽기 전용 (viewer)
 *   or 링크 추가 가능 (contributor); sent a few at a time, they must accept.
 * - 공유 상태 (always shown): [공유 중 N] | [초대 대기 N] tabs of one-line rows with a role badge;
 *   changing the permission, removing and cancelling live behind each row's "⋯" menu.
 * While 모든 사용자 is on, its permission is the minimum for every specific person (a server rule):
 * under 읽기 전용 each person still gets 읽기 전용 or 링크 추가 가능; under 링크 추가 가능 the per-person
 * choice is fixed to 링크 추가 가능, and turning the link on as (or raising it to) 링크 추가 가능 is
 * refused while someone is still 읽기 전용 - nothing is ever changed automatically. The lists refresh on
 * focus, on returning to the app and when an invitation is answered (Push). Opening this screen
 * never changes anything by itself.
 */
export function CollectionShareScreen({ route }: Props) {
  const { collectionId } = route.params;
  const { t } = useTranslation();
  const authenticatedRequest = useAuthenticatedApi();

  const [collection, setCollection] = useState<Collection | null>(null);
  const [share, setShare] = useState<CollectionShare | null>(null);
  const [participants, setParticipants] = useState<CollectionParticipants | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [isManagingShare, setIsManagingShare] = useState(false);
  const [shareError, setShareError] = useState<string | null>(null);
  // Reported by the 공유 비밀번호 card below (Owner only).
  const [sharePasswordMode, setSharePasswordMode] = useState<SharePasswordMode | null>(null);
  const [isUnshareConfirmVisible, setIsUnshareConfirmVisible] = useState(false);
  // 모든 사용자 읽기 전용/링크 추가 가능 chosen before the link exists; once it exists, the link's own permission rules.
  const [pendingPublicPermission, setPendingPublicPermission] = useState<PublicSharePermission>('read');
  // The two main tabs. Chosen once on the first load (the 모든 사용자 tab when its link is already
  // on, 초대하기 otherwise), then only by the user - a refresh never switches it. Switching never
  // loses anything: the invite batch, the typed Juple ID and every choice live on this screen.
  const [mainTab, setMainTab] = useState<MainTab | null>(null);
  const [inviteTab, setInviteTab] = useState<'friends' | 'id'>('friends');
  const [statusTab, setStatusTab] = useState<'members' | 'pending'>('members');

  const [drafts, setDrafts] = useState<readonly InviteDraft[]>([]);
  const [isFriendPickerVisible, setIsFriendPickerVisible] = useState(false);
  const [idInput, setIdInput] = useState('');
  const [idRole, setIdRole] = useState<InvitationRole>('viewer');
  const [idLookup, setIdLookup] = useState<{ status: 'idle' | 'lookingUp' | 'found' | 'error'; person: JupleIdLookupResult | null; message: string | null }>(
    { status: 'idle', person: null, message: null },
  );
  const isSendingRef = useRef(false);
  const scrollRef = useRef<ScrollViewInstance>(null);
  const contentRef = useRef<ViewInstance>(null);
  const idAreaRef = useRef<ViewInstance>(null);
  const statusCardRef = useRef<ViewInstance>(null);
  const participantsRequestRef = useRef(0);
  const [isSending, setIsSending] = useState(false);
  const [inviteNotice, setInviteNotice] = useState<string | null>(null);

  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [managed, setManaged] = useState<ManagedPerson | null>(null);
  const [pendingRemoval, setPendingRemoval] = useState<{ jupleId: string; label: string } | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  /** A newer request always wins - a slow older response never overwrites fresher lists. */
  const loadParticipants = useCallback(async () => {
    const requestId = ++participantsRequestRef.current;
    const loaded = await getCollectionParticipants(authenticatedRequest, collectionId);
    if (requestId === participantsRequestRef.current) {
      setParticipants(loaded);
    }
  }, [authenticatedRequest, collectionId]);

  /** Quiet refresh (no spinner): the link state and both lists, e.g. after someone answered. */
  const refreshQuietly = useCallback(() => {
    const requestId = ++participantsRequestRef.current;
    Promise.all([getCollectionShare(authenticatedRequest, collectionId), getCollectionParticipants(authenticatedRequest, collectionId)])
      .then(([loadedShare, loadedParticipants]) => {
        if (requestId === participantsRequestRef.current) {
          setShare(loadedShare);
          setParticipants(loadedParticipants);
        }
      })
      .catch(() => undefined);
  }, [authenticatedRequest, collectionId]);

  const load = useCallback(async () => {
    setIsLoading(true);
    setLoadError(null);
    try {
      const [loadedCollection, loadedShare, loadedParticipants] = await Promise.all([
        getCollection(authenticatedRequest, collectionId),
        getCollectionShare(authenticatedRequest, collectionId),
        getCollectionParticipants(authenticatedRequest, collectionId),
      ]);
      setCollection(loadedCollection);
      setShare(loadedShare);
      setParticipants(loadedParticipants);
      setMainTab(previous => previous ?? (loadedShare ? 'public' : 'invite'));
    } catch (caughtError) {
      setLoadError(
        caughtError instanceof ApiError && (caughtError.kind === 'forbidden' || caughtError.kind === 'notFound')
          ? t('collaboration.ownerOnly')
          : t('collaboration.loadFallback'),
      );
    } finally {
      setIsLoading(false);
    }
  }, [authenticatedRequest, collectionId, t]);

  useFocusEffect(
    useCallback(() => {
      load();
      ensurePushPermissionOnce(authenticatedRequest);
    }, [authenticatedRequest, load]),
  );

  // An invitee accepting/declining moves them between 초대 대기 and 공유 중 without leaving the screen.
  useLiveRefresh(refreshQuietly, ['collectionInvitationAnswered']);

  // Narrow screens (small phones, industrial PDAs, split screen, large font): a person row puts the
  // name and its X / + on one line and the permission choice full-width below it, instead of
  // letting the buttons fall onto a line of their own. Measured from the window, so rotating or
  // resizing re-decides it without a flash of the wrong layout.
  const { width: windowWidth, fontScale } = useWindowDimensions();
  const cardInnerWidth = Math.min(windowWidth, CONTENT_MAX_WIDTH) - 2 * (spacing.lg + spacing.lg);
  const isCompactRows = cardInnerWidth < INLINE_PERSON_ROW_MIN_WIDTH * Math.max(1, fontScale);
  const activeMainTab: MainTab = mainTab ?? 'invite';

  const isOwnerView = participants?.canManage === true;
  const members = [...(participants?.participants ?? [])].sort(
    (left, right) => ROLE_ORDER[memberRoleOf(left.role)] - ROLE_ORDER[memberRoleOf(right.role)],
  );
  const pendingInvitations = participants?.pendingInvitations ?? [];
  /** Someone (member or still-pending invitation) below this permission's minimum - i.e. 읽기 전용 under 링크 추가 가능. */
  const hasRoleMismatch = (permission: PublicSharePermission): boolean => {
    if (minimumRoleForPublicPermission(permission) !== 'contributor') {
      return false;
    }
    return (
      members.some(member => member.role !== 'owner' && memberRoleOf(member.role) === 'viewer')
      || pendingInvitations.some(invitation => invitationRoleOf(invitation.role) === 'viewer')
    );
  };

  // ---------- 모든 사용자 (public link: 읽기 or 작성) ----------

  const publicPermission: PublicSharePermission = share ? share.permission ?? 'read' : pendingPublicPermission;
  // While the link is on as 링크 추가 가능, every specific person is 링크 추가 가능 too; under 읽기 전용 each keeps their own choice.
  const lockedRole: InvitationRole | null = share ? minimumRoleForPublicPermission(share.permission ?? 'read') : null;
  const isPublicBlocked = !share && hasRoleMismatch(pendingPublicPermission);
  // Still protected by the Owner's lock password for the recipients it already had (legacy): no new
  // recipient - neither a new link nor an invitation - until the Owner sets this Collection's own
  // share password or removes the protection in the card below. The server refuses it as well.
  const needsSharePasswordMigration = sharePasswordMode === 'legacyCommonLock';

  const showMembers = () => {
    Keyboard.dismiss();
    setStatusTab('members');
    setTimeout(() => {
      if (statusCardRef.current && contentRef.current) {
        statusCardRef.current.measureLayout(contentRef.current, (_x, y) => scrollRef.current?.scrollTo({ y: Math.max(0, y - spacing.lg), animated: true }));
      }
    }, 50);
  };

  /** Keeps the Juple ID field and its result above the keyboard (edge-to-edge Android no longer resizes). */
  const scrollToIdArea = () => {
    setTimeout(() => {
      if (idAreaRef.current && contentRef.current) {
        idAreaRef.current.measureLayout(contentRef.current, (_x, y) => scrollRef.current?.scrollTo({ y: Math.max(0, y - spacing.lg), animated: true }));
      }
    }, 250);
  };

  /** 공유 시작: only this explicit action creates (or, idempotently, returns) the public link. */
  const startPublicShare = async () => {
    if (isManagingShare) {
      return;
    }
    if (hasRoleMismatch(pendingPublicPermission)) {
      setShareError(t('shareSheet.permissionMismatch'));
      return;
    }
    setIsManagingShare(true);
    setShareError(null);
    try {
      setShare(await enableCollectionShare(authenticatedRequest, collectionId, pendingPublicPermission));
    } catch (caughtError) {
      setShareError(getShareManagementErrorMessage(caughtError, t, pendingPublicPermission));
    } finally {
      setIsManagingShare(false);
    }
  };

  const stopPublicShare = async () => {
    if (isManagingShare) {
      return;
    }
    setIsManagingShare(true);
    setShareError(null);
    try {
      await revokeCollectionShare(authenticatedRequest, collectionId);
      setShare(null);
    } catch (caughtError) {
      setShareError(getShareManagementErrorMessage(caughtError, t, null));
    } finally {
      setIsManagingShare(false);
    }
  };

  /** 읽기 ↔ 작성 for everyone: before the link exists it is only remembered; afterwards it is saved at once. */
  const changePublicPermission = async (permission: PublicSharePermission) => {
    // A reason shown for an earlier attempt never lingers under a different choice.
    setShareError(null);
    if (!share) {
      setPendingPublicPermission(permission);
      return;
    }
    if (isManagingShare) {
      return;
    }
    if (hasRoleMismatch(permission)) {
      setShareError(t('shareSheet.permissionMismatch'));
      return;
    }
    setIsManagingShare(true);
    setShareError(null);
    try {
      setShare(await setCollectionSharePermission(authenticatedRequest, collectionId, permission));
    } catch (caughtError) {
      setShareError(getShareManagementErrorMessage(caughtError, t, permission));
    } finally {
      setIsManagingShare(false);
    }
  };

  const shareLink = async () => {
    if (!share || !collection) {
      return;
    }
    try {
      await shareItem(share.shareUrl, collection.name);
    } catch {
      setShareError(t('item.shareError'));
    }
  };

  // ---------- 친구 초대 / ID 초대하기: one invitation batch ----------

  /** Why this Juple ID cannot go into the batch, or null when it can. */
  const unavailableReason = (jupleId: string, isSelf = false): string | null => {
    if (isSelf || members.some(member => member.isMe && member.jupleId === jupleId)) {
      return t('collaboration.cannotInviteSelf');
    }
    if (members.some(member => member.jupleId === jupleId)) {
      return t('collaboration.alreadyCollaborator');
    }
    if (pendingInvitations.some(invitation => invitation.jupleId === jupleId)) {
      return t('collaboration.invitationAlreadyPending');
    }
    if (drafts.some(draft => draft.jupleId === jupleId)) {
      return t('shareSheet.duplicateInvitee');
    }
    return null;
  };

  /** Friends picked in 친구 선택 join the batch with 읽기 전용 (or 링크 추가 가능 when the link fixes it); each can be switched on its own. */
  const addFriends = (friends: readonly Friend[]) => {
    setIsFriendPickerVisible(false);
    setInviteNotice(null);
    setDrafts(previous => {
      const added = friends
        .filter(friend => !previous.some(draft => draft.jupleId === friend.jupleId))
        // Only the friend's own display name - never the private note the picker shows.
        .map<InviteDraft>(friend => ({
          jupleId: friend.jupleId,
          displayName: friend.displayName,
          role: lockedRole ?? 'viewer',
          status: 'ready',
          message: null,
        }));
      return [...previous, ...added];
    });
  };

  /** Looks the typed Juple ID up - only when 찾기 is pressed, never while typing. */
  const findById = async () => {
    const typed = normalizeJupleIdInput(idInput);
    if (!typed || idLookup.status === 'lookingUp') {
      return;
    }
    const known = unavailableReason(typed);
    if (known) {
      setIdLookup({ status: 'error', person: null, message: known });
      return;
    }
    setIdLookup({ status: 'lookingUp', person: null, message: null });
    try {
      const result = await lookupJupleId(authenticatedRequest, idInput.trim());
      const reason = unavailableReason(result.jupleId, result.isSelf);
      setIdLookup(reason ? { status: 'error', person: null, message: reason } : { status: 'found', person: result, message: null });
      scrollToIdArea();
    } catch (caughtError) {
      setIdLookup({ status: 'error', person: null, message: getLookupErrorMessage(caughtError, t) });
    }
  };

  /** "+": the found person joins the batch, and the field is cleared for the next Juple ID. */
  const addFoundPerson = () => {
    const person = idLookup.person;
    if (!person) {
      return;
    }
    const reason = unavailableReason(person.jupleId, person.isSelf);
    if (reason) {
      setIdLookup({ status: 'error', person: null, message: reason });
      return;
    }
    setInviteNotice(null);
    setDrafts(previous => [
      ...previous,
      { jupleId: person.jupleId, displayName: person.displayName ?? null, role: lockedRole ?? idRole, status: 'ready', message: null },
    ]);
    setIdInput('');
    setIdRole('viewer');
    setIdLookup({ status: 'idle', person: null, message: null });
  };

  const setDraftRole = (jupleId: string, role: InvitationRole) => {
    if (lockedRole) {
      return;
    }
    setActionError(null);
    setDrafts(previous => previous.map(draft => (draft.jupleId === jupleId ? { ...draft, role, status: 'ready', message: null } : draft)));
  };

  const removeDraft = (jupleId: string) => setDrafts(previous => previous.filter(draft => draft.jupleId !== jupleId));

  /**
   * Sends the whole batch - friends and Juple IDs alike - one invitation per person, at most
   * INVITE_CONCURRENCY at a time (the server has no batch endpoint and rate-limits per identity).
   * While 모든 사용자 is 링크 추가 가능, the role sent is always that - never whatever a row showed. Sent
   * ones leave the batch (they appear under 초대 대기), failed ones stay with their own reason. A
   * synchronous ref guards against a double tap sending twice.
   */
  const sendInvitations = async () => {
    const batch = drafts.filter(draft => draft.status !== 'sending');
    if (isSendingRef.current || batch.length === 0) {
      return;
    }
    isSendingRef.current = true;
    setIsSending(true);
    setInviteNotice(null);
    setDrafts(previous => previous.map(draft => ({ ...draft, status: 'sending', message: null })));

    const results = await runWithConcurrency(batch, INVITE_CONCURRENCY, draft =>
      inviteCollaborator(authenticatedRequest, collectionId, draft.jupleId, lockedRole ?? draft.role),
    );
    const failed = new Map<string, string>();
    results.forEach((result, index) => {
      if (result.status === 'rejected') {
        failed.set(batch[index].jupleId, getActionErrorMessage(result.reason, t));
      }
    });
    setDrafts(previous =>
      previous
        .filter(draft => failed.has(draft.jupleId) || !batch.some(sent => sent.jupleId === draft.jupleId))
        .map(draft => (failed.has(draft.jupleId) ? { ...draft, status: 'error', message: failed.get(draft.jupleId)! } : draft)),
    );
    const sentCount = batch.length - failed.size;
    if (sentCount > 0) {
      setInviteNotice(t('shareSheet.invitationsSent', { count: sentCount }));
    }
    try {
      await loadParticipants();
    } catch {
      // Each person's result above already says what happened; the lists refresh on next focus.
    }
    isSendingRef.current = false;
    setIsSending(false);
  };

  // ---------- 공유 중인 사용자 / 초대 대기 ----------

  const runAction = async (key: string, action: () => Promise<void>) => {
    if (busyKey !== null) {
      return;
    }
    setBusyKey(key);
    setActionError(null);
    try {
      await action();
    } catch (caughtError) {
      setActionError(getActionErrorMessage(caughtError, t));
    }
    try {
      await loadParticipants();
    } catch {
      // Keep what is shown; it refreshes on next focus.
    } finally {
      setBusyKey(null);
    }
  };

  const changeRole = (person: ManagedPerson, role: InvitationRole) => {
    if (lockedRole) {
      setActionError(t('collaboration.blockedByPublicShare'));
      return;
    }
    if (person.kind === 'member') {
      runAction(`role-${person.jupleId}`, () => changeCollaboratorRole(authenticatedRequest, collectionId, person.jupleId, role));
    } else {
      runAction(`pending-role-${person.invitationId}`, () => changeInvitationRole(authenticatedRequest, collectionId, person.invitationId, role));
    }
  };

  /** The "⋯" menu of one row: switch to the other permission (not while 모든 사용자 링크 추가 가능 fixes it), then remove / cancel. */
  const menuActions: readonly ActionMenuDialogAction[] = managed
    ? [
        ...(lockedRole
          ? []
          : [
              {
                label: managed.role === 'viewer' ? t('shareSheet.changeToWrite') : t('shareSheet.changeToRead'),
                onPress: () => {
                  const person = managed;
                  setManaged(null);
                  changeRole(person, person.role === 'viewer' ? 'contributor' : 'viewer');
                },
              },
            ]),
        managed.kind === 'member'
          ? {
              label: t('shareSheet.removeMember'),
              destructive: true,
              onPress: () => {
                const person = managed;
                setManaged(null);
                setPendingRemoval({ jupleId: person.jupleId, label: person.label });
              },
            }
          : {
              label: t('shareSheet.cancelInvitation'),
              destructive: true,
              onPress: () => {
                const person = managed;
                setManaged(null);
                runAction(`revoke-${person.invitationId}`, () =>
                  revokeCollectionInvitation(authenticatedRequest, collectionId, person.invitationId));
              },
            },
      ]
    : [];

  // Friends who are already in, already invited, or already in this batch can't be picked again.
  const unavailableFriends = new Map<string, FriendUnavailableReason>();
  members.forEach(member => unavailableFriends.set(member.jupleId, 'member'));
  pendingInvitations.forEach(invitation => unavailableFriends.set(invitation.jupleId, 'pending'));
  drafts.forEach(draft => unavailableFriends.set(draft.jupleId, 'added'));

  const inviteDisabled = !isOwnerView || isSending || needsSharePasswordMigration;

  const personText = (person: { readonly jupleId: string; readonly displayName?: string | null }, label?: string) => (
    <View style={styles.personText}>
      <Text numberOfLines={1} style={styles.personName}>{label ?? personLabel(person)}</Text>
      {person.displayName ? <Text numberOfLines={1} style={[styles.jupleId, ltrTextStyle]}>{formatJupleId(person.jupleId)}</Text> : null}
    </View>
  );

  const moreButton = (label: string, onPress: () => void, testID: string) => (
    <Pressable
      accessibilityLabel={t('shareSheet.memberActionsA11y', { name: label })}
      accessibilityRole="button"
      disabled={busyKey !== null}
      hitSlop={8}
      onPress={onPress}
      style={[styles.iconButton, busyKey !== null && styles.disabled]}
      testID={testID}
    >
      <MoreIcon color={colors.textSecondary} size={20} />
    </Pressable>
  );

  return (
    <StackScreenSafeArea style={styles.safeArea}>
      <KeyboardAvoidingView behavior="padding" style={styles.flex}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" ref={scrollRef}>
        {isLoading && !participants ? <ActivityIndicator style={styles.loading} /> : null}
        {loadError ? <Text style={styles.error}>{loadError}</Text> : null}

        {participants ? (
          <View ref={contentRef} testID="share-unified">
            {/* The two ways to share, as two main tabs over one panel (never two stacked cards) -
                together one bordered section, set apart from 공유 상태 below. */}
            <View style={[styles.card, styles.shareWaysSection]} testID="share-ways-section">
            <Segmented
              kind="tabs"
              onChange={tab => {
                Keyboard.dismiss();
                setMainTab(tab);
              }}
              options={[
                { key: 'public', label: t('shareSheet.allUsersTitle'), isActive: share !== null },
                { key: 'invite', label: t('shareSheet.inviteTitle') },
              ]}
              size="large"
              testID="share-main-tabs"
              value={activeMainTab}
            />

            {activeMainTab === 'public' ? (
              // A. 모든 사용자 공유: the public link with its permission.
              <View style={styles.panel} testID="share-all-users">
                <Segmented
                  disabled={isManagingShare}
                  kind="radio"
                  onChange={changePublicPermission}
                  // Re-choosing the current permission (e.g. 읽기 전용 after a refused 링크 추가) clears
                  // that attempt's reason - it never stays under a choice it was not about.
                  onReselect={() => setShareError(null)}
                  options={[
                    { key: 'read', label: t('shareSheet.permissionRead') },
                    { key: 'write', label: t('shareSheet.permissionWrite') },
                  ]}
                  testID="share-all-users-permission"
                  value={publicPermission}
                />
                <Text style={styles.help} testID="share-all-users-description">
                  {publicPermission === 'write' ? t('shareSheet.allUsersWriteDescription') : t('shareSheet.allUsersDescription')}
                </Text>
                {share ? (
                  <>
                    <View style={styles.linkBox}>
                      <Text numberOfLines={2} selectable style={[styles.link, ltrTextStyle]} testID="share-link">{share.shareUrl}</Text>
                    </View>
                    <View style={styles.buttonRow}>
                      <Pressable accessibilityRole="button" onPress={shareLink} style={[styles.primaryButton, styles.flexButton]} testID="share-link-action">
                        <Text numberOfLines={2} style={styles.primaryLabel}>{t('shareSheet.shareLink')}</Text>
                      </Pressable>
                      <Pressable
                        accessibilityRole="button"
                        disabled={isManagingShare}
                        onPress={() => setIsUnshareConfirmVisible(true)}
                        style={[styles.secondaryButton, styles.flexButton]}
                        testID="share-stop"
                      >
                        <Text numberOfLines={2} style={styles.removeLabel}>{t('shareSheet.stopSharing')}</Text>
                      </Pressable>
                    </View>
                  </>
                ) : (
                  <>
                    {needsSharePasswordMigration ? (
                      <View style={styles.noticeBox} testID="share-public-migration-required">
                        <Text style={styles.noticeText}>{t('collections.sharePasswordLegacyNotice')}</Text>
                      </View>
                    ) : null}
                    {isPublicBlocked ? (
                      <View style={styles.noticeBox} testID="share-public-blocked">
                        <Text style={styles.noticeText}>{t('shareSheet.permissionMismatch')}</Text>
                        <Text style={styles.help}>{t('shareSheet.permissionMismatchHint')}</Text>
                        <Pressable accessibilityRole="button" onPress={showMembers} style={styles.inlineAction} testID="share-public-blocked-review">
                          <Text style={styles.inlineActionLabel}>{t('shareSheet.reviewMembers')}</Text>
                        </Pressable>
                      </View>
                    ) : null}
                    <Pressable
                      accessibilityRole="button"
                      accessibilityState={{ disabled: isManagingShare || isPublicBlocked || needsSharePasswordMigration, busy: isManagingShare }}
                      disabled={isManagingShare || isPublicBlocked || needsSharePasswordMigration}
                      onPress={startPublicShare}
                      style={[styles.primaryButton, (isManagingShare || isPublicBlocked || needsSharePasswordMigration) && styles.disabled]}
                      testID="share-create-link"
                    >
                      {isManagingShare ? <ActivityIndicator color={colors.surface} size="small" /> : <Text style={styles.primaryLabel}>{t('shareSheet.startSharing')}</Text>}
                    </Pressable>
                  </>
                )}
                {collection && isCollectionLocked(collection) ? (
                  <Text style={styles.help} testID="share-locked-note">{t('shareSheet.lockedLinkNote')}</Text>
                ) : null}
                {shareError ? <Text style={styles.error}>{shareError}</Text> : null}
              </View>
            ) : (
              // B. 초대하기: [친구] | [ID] feeding one batch of people, each with their own permission.
              <View style={styles.panel} testID="share-invite">
                {needsSharePasswordMigration ? (
                  <View style={styles.noticeBox} testID="share-invite-migration-required">
                    <Text style={styles.noticeText}>{t('collections.sharePasswordLegacyNotice')}</Text>
                  </View>
                ) : null}
                <Segmented
                  kind="tabs"
                  onChange={setInviteTab}
                  options={[
                    { key: 'friends', label: t('shareSheet.inviteTabFriends') },
                    { key: 'id', label: t('shareSheet.inviteTabId') },
                  ]}
                  testID="share-invite-tabs"
                  value={inviteTab}
                />
                {lockedRole ? <FixedRoleBadge testID="share-invite-fixed-role" /> : null}
                {inviteTab === 'friends' ? (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityState={{ disabled: inviteDisabled }}
                    disabled={inviteDisabled}
                    onPress={() => setIsFriendPickerVisible(true)}
                    style={[styles.outlineButton, inviteDisabled && styles.disabled]}
                    testID="invite-choose-friends"
                  >
                    <Text style={styles.outlineButtonLabel}>{t('shareSheet.chooseFriends')}</Text>
                  </Pressable>
                ) : (
                  <View ref={idAreaRef} style={styles.idArea} testID="share-id-invite">
                    <View style={styles.lookupRow}>
                      <TextInput
                        accessibilityLabel={t('collaboration.jupleIdLabel')}
                        autoCapitalize="characters"
                        autoCorrect={false}
                        editable={!inviteDisabled}
                        maxLength={16}
                        onChangeText={value => {
                          setIdInput(value);
                          setIdLookup({ status: 'idle', person: null, message: null });
                        }}
                        onFocus={scrollToIdArea}
                        onSubmitEditing={findById}
                        placeholder={t('collaboration.jupleIdPlaceholder')}
                        style={[styles.input, inviteDisabled && styles.disabled]}
                        testID="id-invite-input"
                        value={idInput}
                      />
                      <Pressable
                        accessibilityRole="button"
                        accessibilityState={{ disabled: inviteDisabled || !idInput.trim() }}
                        disabled={inviteDisabled || !idInput.trim() || idLookup.status === 'lookingUp'}
                        onPress={findById}
                        style={[styles.secondaryButton, (inviteDisabled || !idInput.trim()) && styles.disabled]}
                        testID="id-invite-find"
                      >
                        {idLookup.status === 'lookingUp' ? <ActivityIndicator size="small" /> : <Text numberOfLines={1} style={styles.secondaryLabel}>{t('collaboration.find')}</Text>}
                      </Pressable>
                    </View>
                    {idLookup.status === 'found' && idLookup.person ? (
                      // Who - their permission - "+". One line when there is room; otherwise who on
                      // top, and the permission with "+" at its end below it.
                      <View style={[styles.personRow, isCompactRows && styles.personRowCompact]} testID="id-invite-person">
                        <View style={styles.personRowText}>{personText(idLookup.person)}</View>
                        <View style={[styles.rowControls, isCompactRows && styles.rowControlsCompact]}>
                          {lockedRole ? null : (
                            <RoleToggle
                              label={personLabel(idLookup.person)}
                              onChange={role => {
                                setActionError(null);
                                setIdRole(role);
                              }}
                              stretch={isCompactRows}
                              testID="id-invite-role"
                              value={idRole}
                            />
                          )}
                          <Pressable
                            accessibilityLabel={t('shareSheet.addPersonToInviteList', { name: personLabel(idLookup.person) })}
                            accessibilityRole="button"
                            onPress={addFoundPerson}
                            style={[styles.addButton, isCompactRows && lockedRole !== null && styles.addButtonEnd]}
                            testID="id-invite-add"
                          >
                            <PlusIcon color={colors.surface} size={20} strokeWidth={2.25} />
                          </Pressable>
                        </View>
                      </View>
                    ) : null}
                    {idLookup.message ? <Text style={styles.error} testID="id-invite-error">{idLookup.message}</Text> : null}
                  </View>
                )}

                {drafts.length > 0 ? (
                  <View style={styles.batch} testID="share-invite-list">
                    <View style={styles.batchHeader}>
                      <Text numberOfLines={1} style={styles.batchTitle}>{t('shareSheet.inviteListTitle')}</Text>
                      <Text numberOfLines={1} style={styles.cardCount} testID="share-invite-list-count">{t('shareSheet.selectedCount', { count: drafts.length })}</Text>
                    </View>
                    {drafts.map((draft, index) => {
                      const removeButton = (
                        <Pressable
                          accessibilityLabel={t('common.delete')}
                          accessibilityRole="button"
                          disabled={draft.status === 'sending'}
                          hitSlop={8}
                          onPress={() => removeDraft(draft.jupleId)}
                          style={styles.iconButton}
                          testID={`draft-remove-${draft.jupleId}`}
                        >
                          <CloseIcon color={colors.textSecondary} size={18} />
                        </Pressable>
                      );
                      const roleToggle = lockedRole ? null : (
                        <RoleToggle
                          disabled={draft.status === 'sending'}
                          label={personLabel(draft)}
                          onChange={role => setDraftRole(draft.jupleId, role)}
                          stretch={isCompactRows}
                          testID={`draft-role-${draft.jupleId}`}
                          value={draft.role}
                        />
                      );
                      return (
                        <View key={draft.jupleId} style={[styles.listRow, index > 0 && styles.listRowDivider]} testID={`draft-${draft.jupleId}`}>
                          {/* Name and its X always share one line; the permission joins them when
                              there is room, and otherwise gets the full line below. */}
                          <View style={styles.rowLine}>
                            {personText(draft)}
                            {isCompactRows ? null : roleToggle}
                            {removeButton}
                          </View>
                          {isCompactRows ? roleToggle : null}
                          {draft.message ? <Text style={styles.error} testID={`draft-error-${draft.jupleId}`}>{draft.message}</Text> : null}
                        </View>
                      );
                    })}
                    <Pressable
                      accessibilityRole="button"
                      accessibilityState={{ disabled: inviteDisabled, busy: isSending }}
                      disabled={inviteDisabled}
                      onPress={sendInvitations}
                      style={[styles.primaryButton, inviteDisabled && styles.disabled]}
                      testID="invite-send"
                    >
                      {isSending ? <ActivityIndicator color={colors.surface} size="small" /> : <Text style={styles.primaryLabel}>{t('shareSheet.sendInvitations')}</Text>}
                    </Pressable>
                  </View>
                ) : null}
                {inviteNotice ? <Text style={styles.notice} testID="invite-notice">{inviteNotice}</Text> : null}
              </View>
            )}
            </View>
            {actionError ? <Text style={[styles.error, styles.actionError]} testID="share-action-error">{actionError}</Text> : null}

            {/* B. 공유 비밀번호: one setting for every way of sharing above, separate from both - and
                from the Owner's own Collection lock. Owner only. */}
            {isOwnerView ? (
              <SharePasswordCard authenticatedRequest={authenticatedRequest} collectionId={collectionId} onModeChange={setSharePasswordMode} />
            ) : null}

            {/* C. 공유 상태: [공유 중 N] | [초대 대기 N] - pending invitations are not always spread out. */}
            <View ref={statusCardRef}>
            <SectionCard icon={<PeopleIcon color={colors.textSecondary} size={18} />} testID="share-status" title={t('shareSheet.statusTitle')}>
              <Segmented
                kind="tabs"
                onChange={setStatusTab}
                options={[
                  { key: 'members', label: t('shareSheet.statusTabMembers', { count: members.length }) },
                  ...(isOwnerView ? [{ key: 'pending' as const, label: t('shareSheet.statusTabPending', { count: pendingInvitations.length }) }] : []),
                ]}
                testID="share-status-tabs"
                value={statusTab}
              />
              {statusTab === 'members' ? (
                <View testID="share-members">
                  {members.map((member, index) => {
                    const kind = memberRoleOf(member.role);
                    const label = member.isMe ? t('collections.participantMe', { name: personLabel(member) }) : personLabel(member);
                    return (
                      <View key={member.jupleId} style={[styles.listRow, styles.listRowMain, index > 0 && styles.listRowDivider]} testID={`participant-${member.jupleId}`}>
                        {kind === 'owner' ? <OwnerCrown /> : null}
                        {personText(member, label)}
                        <RoleBadge kind={kind} testID={`participant-role-${member.jupleId}`} />
                        {kind !== 'owner' && isOwnerView
                          ? moreButton(personLabel(member), () =>
                              setManaged({ kind: 'member', jupleId: member.jupleId, label: personLabel(member), role: kind }), `member-actions-${member.jupleId}`)
                          : null}
                      </View>
                    );
                  })}
                </View>
              ) : (
                <View testID="share-pending">
                  {pendingInvitations.length === 0 ? (
                    <Text style={styles.help}>{t('collaboration.pendingEmpty')}</Text>
                  ) : (
                    pendingInvitations.map((invitation, index) => {
                      const role = invitationRoleOf(invitation.role);
                      return (
                        <View key={invitation.invitationId} style={[styles.listRow, styles.listRowMain, index > 0 && styles.listRowDivider]} testID={`pending-${invitation.invitationId}`}>
                          <View style={styles.personText}>
                            <Text numberOfLines={1} style={styles.personName}>{personLabel(invitation)}</Text>
                            <Text numberOfLines={1} style={styles.pendingStatus}>
                              {invitation.displayName ? `${formatJupleId(invitation.jupleId)} · ` : ''}{t('shareSheet.pendingStatus')}
                            </Text>
                          </View>
                          <RoleBadge kind={role} testID={`pending-role-${invitation.invitationId}`} />
                          {moreButton(personLabel(invitation), () =>
                            setManaged({ kind: 'pending', invitationId: invitation.invitationId, label: personLabel(invitation), role }), `pending-actions-${invitation.invitationId}`)}
                        </View>
                      );
                    })
                  )}
                </View>
              )}
            </SectionCard>
            </View>
          </View>
        ) : null}
      </ScrollView>
      </KeyboardAvoidingView>
      <FriendPickerModal
        authenticatedRequest={authenticatedRequest}
        onClose={() => setIsFriendPickerVisible(false)}
        onConfirm={addFriends}
        unavailable={unavailableFriends}
        visible={isFriendPickerVisible}
      />
      <ActionMenuDialog
        actions={menuActions}
        cancelLabel={t('common.cancel')}
        onCancel={() => setManaged(null)}
        title={managed?.label}
        visible={managed !== null}
      />
      <ConfirmDialog
        cancelLabel={t('common.cancel')}
        confirmLabel={t('shareSheet.stopSharing')}
        destructive
        message={t('collections.unshareConfirmMessage')}
        onCancel={() => setIsUnshareConfirmVisible(false)}
        onConfirm={() => {
          setIsUnshareConfirmVisible(false);
          stopPublicShare();
        }}
        title={t('shareSheet.stopSharingConfirmTitle')}
        visible={isUnshareConfirmVisible}
      />
      <ConfirmDialog
        cancelLabel={t('common.cancel')}
        confirmLabel={t('collaboration.remove')}
        destructive
        message={t('collaboration.removeConfirmMessage')}
        onCancel={() => setPendingRemoval(null)}
        onConfirm={() => {
          const target = pendingRemoval;
          setPendingRemoval(null);
          if (target) {
            runAction(`remove-${target.jupleId}`, () => removeCollaborator(authenticatedRequest, collectionId, target.jupleId));
          }
        }}
        title={t('collaboration.removeConfirmTitle')}
        visible={pendingRemoval !== null}
      />
    </StackScreenSafeArea>
  );
}

// Role badges: 소유자 in the soft amber tile pair, 쓰기 in the brand tint, 읽기 neutral - existing tokens only.
const badgeStyles = StyleSheet.create({
  owner: { backgroundColor: categoryTilePalette[2].background },
  contributor: { backgroundColor: colors.brandSoft },
  viewer: { backgroundColor: colors.surfaceMuted },
});

const badgeLabelStyles = StyleSheet.create({
  owner: { color: categoryTilePalette[2].icon },
  contributor: { color: colors.brand },
  viewer: { color: colors.textSecondary },
});

const styles = StyleSheet.create({
  safeArea: { backgroundColor: colors.background, flex: 1 },
  content: { alignSelf: 'center', maxWidth: CONTENT_MAX_WIDTH, padding: spacing.lg, width: '100%' },
  // A section card: a light neutral 1px outline (the app's own soft card border) so each section
  // reads as its own block on the screen background, without a heavy rule.
  card: {
    backgroundColor: colors.surface,
    borderColor: colors.inputBorder,
    borderRadius: radii.lg,
    borderWidth: 1,
    gap: spacing.sm,
    marginBottom: spacing.md,
    padding: spacing.lg,
  },
  // The main tabs and the selected tab's panel, one section - a wider gap before 공유 상태.
  shareWaysSection: { marginBottom: spacing.xl, padding: spacing.md },
  // The selected main tab's panel, right under the tabs inside the same section.
  panel: { gap: spacing.sm, marginTop: spacing.md, paddingHorizontal: spacing.xs },
  actionError: { marginBottom: spacing.md },
  cardHeader: { alignItems: 'center', flexDirection: 'row', gap: spacing.sm },
  cardIcon: { alignItems: 'center', backgroundColor: colors.surfaceMuted, borderRadius: 14, height: 28, justifyContent: 'center', width: 28 },
  cardTitle: { color: colors.textPrimary, flex: 1, flexShrink: 1, fontSize: 16, fontWeight: '700' },
  cardCount: { color: colors.textSecondary, fontSize: 14, fontWeight: '600' },
  // Never wider than about half a row, so the person's name always keeps its own share of the line.
  badge: { borderRadius: radii.md, flexShrink: 1, maxWidth: '45%', paddingHorizontal: spacing.sm, paddingVertical: 3 },
  segmented: {
    backgroundColor: colors.surfaceMuted,
    borderRadius: radii.md + 2,
    flexDirection: 'row',
    gap: 2,
    padding: 2,
  },
  segmentedLarge: { borderRadius: radii.md + 4, padding: 3 },
  segment: {
    alignItems: 'center',
    borderRadius: radii.md,
    flex: 1,
    flexDirection: 'row',
    gap: spacing.xs + 2,
    justifyContent: 'center',
    minHeight: minTouchTarget - 4,
    minWidth: 0,
    paddingHorizontal: spacing.sm,
  },
  segmentLarge: { minHeight: minTouchTarget + 4, paddingVertical: spacing.xs },
  segmentActiveDot: { backgroundColor: colors.success, borderRadius: 4, flexShrink: 0, height: 8, width: 8 },
  segmentSelected: { backgroundColor: colors.surface, borderColor: colors.brand, borderWidth: 1 },
  segmentLabel: { color: colors.textSecondary, flexShrink: 1, fontSize: 14, fontWeight: '600', textAlign: 'center' },
  segmentLabelLarge: { fontSize: 15 },
  segmentLabelSelected: { color: colors.brand, fontWeight: '700' },
  idArea: { gap: spacing.sm },
  batch: { borderTopColor: colors.divider, borderTopWidth: 1, gap: spacing.xs, marginTop: spacing.xs, paddingTop: spacing.sm },
  batchHeader: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
  batchTitle: { color: colors.textPrimary, flexShrink: 1, fontSize: 14, fontWeight: '700' },
  badgeLabel: { fontSize: 12, fontWeight: '700' },
  linkBox: { backgroundColor: colors.surfaceMuted, borderRadius: radii.md, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  link: { color: colors.textPrimary, fontSize: 14 },
  buttonRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  flexButton: { flexBasis: 140, flexGrow: 1 },
  noticeBox: { backgroundColor: colors.surfaceMuted, borderRadius: radii.md, gap: spacing.xs, padding: spacing.md },
  noticeText: { color: colors.textPrimary, fontSize: 13, fontWeight: '600' },
  notice: { color: colors.textSecondary, fontSize: 13, fontWeight: '600', marginBottom: spacing.sm },
  outlineButton: {
    alignItems: 'center',
    borderColor: colors.brand,
    borderRadius: radii.md,
    borderWidth: 1,
    justifyContent: 'center',
    minHeight: minTouchTarget,
    paddingHorizontal: spacing.md,
  },
  outlineButtonLabel: { color: colors.brand, fontSize: 15, fontWeight: '700', textAlign: 'center' },
  help: { color: colors.textSecondary, fontSize: 13 },
  lookupRow: { alignItems: 'center', flexDirection: 'row', gap: spacing.sm },
  input: {
    backgroundColor: colors.surface,
    borderColor: colors.inputBorder,
    borderRadius: radii.md + 4,
    borderWidth: 1,
    color: colors.textPrimary,
    flex: 1,
    fontSize: 16,
    letterSpacing: 1,
    minHeight: minTouchTarget,
    minWidth: 0,
    paddingHorizontal: spacing.md,
    writingDirection: 'ltr',
  },
  flex: { flex: 1 },
  personRow: {
    alignItems: 'center',
    backgroundColor: colors.background,
    borderRadius: radii.md,
    flexDirection: 'row',
    gap: spacing.sm,
    padding: spacing.sm,
  },
  personRowText: { flex: 1, minWidth: 0 },
  // Narrow: who on top, then the permission (full width) with its + at the end.
  personRowCompact: { alignItems: 'stretch', flexDirection: 'column' },
  rowControls: { alignItems: 'center', flexDirection: 'row', flexShrink: 0, gap: spacing.sm },
  rowControlsCompact: { alignSelf: 'stretch', flexShrink: 1 },
  addButtonEnd: { marginStart: 'auto' },
  fixedRole: { backgroundColor: colors.surfaceMuted, borderRadius: radii.md, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  fixedRoleLabel: { color: colors.textPrimary, fontSize: 13, fontWeight: '600' },
  inlineAction: { alignSelf: 'flex-start', justifyContent: 'center', minHeight: minTouchTarget },
  inlineActionLabel: { color: colors.brand, fontSize: 14, fontWeight: '700' },
  listRow: { gap: spacing.xs, paddingVertical: spacing.sm },
  // One line, never wrapping: the name gives way (ellipsis) before a badge or button would drop.
  listRowMain: { alignItems: 'center', flexDirection: 'row', gap: spacing.sm },
  rowLine: { alignItems: 'center', flexDirection: 'row', gap: spacing.sm },
  listRowDivider: { borderTopColor: colors.divider, borderTopWidth: 1 },
  personText: { flex: 1, minWidth: 0 },
  personName: { color: colors.textPrimary, fontSize: 15, fontWeight: '700' },
  jupleId: { color: colors.textSecondary, fontSize: 13, fontWeight: '600', letterSpacing: 1 },
  pendingStatus: { color: colors.textSecondary, fontSize: 13 },
  iconButton: { alignItems: 'center', justifyContent: 'center', minHeight: minTouchTarget, minWidth: minTouchTarget },
  addButton: {
    alignItems: 'center',
    backgroundColor: colors.brand,
    borderRadius: radii.md,
    justifyContent: 'center',
    minHeight: minTouchTarget,
    minWidth: minTouchTarget,
  },
  roleToggle: {
    backgroundColor: colors.surfaceMuted,
    borderRadius: radii.md + 2,
    flexDirection: 'row',
    flexShrink: 0,
    gap: 2,
    padding: 2,
  },
  roleToggleStretch: { alignSelf: 'stretch', flexGrow: 1, flexShrink: 1 },
  roleOption: {
    alignItems: 'center',
    borderRadius: radii.md,
    flexShrink: 1,
    justifyContent: 'center',
    minHeight: minTouchTarget,
    minWidth: 0,
    paddingHorizontal: spacing.sm,
  },
  roleOptionStretch: { flexBasis: 0, flexGrow: 1 },
  roleOptionSelected: { backgroundColor: colors.brand },
  roleOptionLabel: { color: colors.textSecondary, fontSize: 14, fontWeight: '600' },
  roleOptionLabelSelected: { color: colors.surface, fontWeight: '700' },
  primaryButton: {
    alignItems: 'center',
    backgroundColor: colors.brand,
    borderRadius: radii.md,
    justifyContent: 'center',
    minHeight: minTouchTarget,
    paddingHorizontal: spacing.md,
  },
  primaryLabel: { color: colors.surface, fontSize: 15, fontWeight: '700', textAlign: 'center' },
  removeLabel: { color: colors.danger, fontSize: 14, fontWeight: '600', textAlign: 'center' },
  secondaryButton: {
    alignItems: 'center',
    borderColor: colors.border,
    borderRadius: radii.md,
    borderWidth: 1,
    flexShrink: 0,
    justifyContent: 'center',
    minHeight: minTouchTarget,
    minWidth: 72,
    paddingHorizontal: spacing.md,
  },
  secondaryLabel: { color: colors.textPrimary, fontSize: 14, fontWeight: '600' },
  disabled: { opacity: 0.45 },
  loading: { paddingVertical: spacing.lg },
  error: { color: colors.danger, fontSize: 14 },
});
