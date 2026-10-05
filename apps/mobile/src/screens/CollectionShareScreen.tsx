import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useCallback, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  type ScrollViewInstance,
  StyleSheet,
  Switch,
  Text,
  TextInput,
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
  INVITATION_ROLE_RANK,
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
import { SearchIconButton } from '../components/SearchIconButton';
import { LoadFailureState } from '../components/LoadFailureState';
import { UserAvatar } from '../components/UserAvatar';
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
import { useAppToast } from '../components/AppToast';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { StackScreenSafeArea } from '../components/StackScreenSafeArea';
import { InfoCallout } from '../components/InfoCallout';
import { CheckIcon } from '../icons/CheckIcon';
import { CloseIcon } from '../icons/CloseIcon';
import { EyeIcon } from '../icons/EyeIcon';
import { UserMinusIcon } from '../icons/UserMinusIcon';
import { usePersonProfile, type PersonProfileTarget } from '../friends/PersonProfileModal';
import { GlobeIcon } from '../icons/GlobeIcon';
import { MoreIcon } from '../icons/MoreIcon';
import { PeopleIcon } from '../icons/PeopleIcon';
import { PlusIcon } from '../icons/PlusIcon';
import { ShareIcon } from '../icons/ShareIcon';
import { UserIcon } from '../icons/UserIcon';
import { shareItem } from '../items/shareItem';
import { ensurePushPermissionOnce } from '../push/pushPermissionFlow';
import { useLiveRefresh } from '../push/useLiveRefresh';
import type { RootStackParamList } from '../navigation/RootStack';
import { categoryTilePalette, colors, ltrTextStyle, minTouchTarget, radii, spacing } from '../theme/tokens';
import { KeyboardSafeView } from '../components/KeyboardSafeView';

type Props = NativeStackScreenProps<RootStackParamList, 'CollectionShare'>;

/** Avatar of a person in the 공유 상태 lists - the same size the participant sheet uses. */
const STATUS_AVATAR_SIZE = 32;

/**
 * Invitations in flight at once. There is no batch size limit - the API takes one invitation per
 * person and has its own per-identity rate limit, so a large batch is simply sent a few at a time,
 * each person keeping their own result.
 */
export const INVITE_CONCURRENCY = 3;

/**
 * While 모든 사용자 is on, its permission is the minimum every specific person has (a server rule
 * too), across three levels - 읽기 전용 < 승인 후 추가 < 링크 추가: under 읽기 전용 each person keeps
 * their own choice (null - any role); under 승인 후 추가 nobody may be 읽기 전용; under 링크 추가
 * everyone is 링크 추가 - a lower role would misstate what the link already lets them do.
 */
export function minimumRoleForPublicPermission(permission: PublicSharePermission): InvitationRole | null {
  return permission === 'write' ? 'contributor' : permission === 'submit' ? 'submitter' : null;
}

/** The role itself, or the minimum when it is below it. */
export function raiseToMinimum(role: InvitationRole, minimum: InvitationRole | null): InvitationRole {
  return minimum !== null && INVITATION_ROLE_RANK[role] < INVITATION_ROLE_RANK[minimum] ? minimum : role;
}

/** The three roles in rank order, as the Owner chooses them. */
const ROLES: readonly InvitationRole[] = ['viewer', 'submitter', 'contributor'];

/** 읽기 전용 / 승인 후 추가 / 링크 추가 - the same three words for the public link and for each person. */
function roleLabelKey(role: InvitationRole): string {
  return role === 'viewer' ? 'shareSheet.permissionRead' : role === 'submitter' ? 'shareSheet.permissionSubmit' : 'shareSheet.permissionWrite';
}

/** The public link's permission in the words used for people too (읽기 전용 / 승인 후 추가 / 링크 추가). */
function publicPermissionLabelKey(permission: PublicSharePermission): string {
  return permission === 'write' ? 'shareSheet.permissionWrite' : permission === 'submit' ? 'shareSheet.permissionSubmit' : 'shareSheet.permissionRead';
}

/** A person waiting in the invitation batch - picked from friends or found by Juple ID - with their own 읽기 전용/링크 추가 가능. */
interface InviteDraft {
  readonly jupleId: string;
  readonly displayName: string | null;
  /** From data already loaded (the friend list / the ID lookup) - the summary above the permission never fetches. */
  readonly profileImageUrl?: string | null;
  readonly profileImageVersion?: string | null;
  readonly role: InvitationRole;
  readonly status: 'ready' | 'sending' | 'error';
  readonly message: string | null;
}

type BadgeKind = 'owner' | InvitationRole;

const CONTENT_MAX_WIDTH = 640;

/** What the "⋯" menu of one row acts on: an accepted member, or a pending invitation. */
type ManagedPerson =
  | { readonly kind: 'member'; readonly jupleId: string; readonly label: string; readonly role: InvitationRole }
  | { readonly kind: 'pending'; readonly invitationId: number; readonly label: string; readonly role: InvitationRole };

/** Canonical form of a typed Juple ID for duplicate checks (the server does the real validation). */
function normalizeJupleIdInput(value: string): string {
  return value.replace(/[\s-]/g, '').toUpperCase();
}

function memberRoleOf(role: string): BadgeKind {
  return role === 'owner' ? 'owner' : role === 'contributor' ? 'contributor' : role === 'submitter' ? 'submitter' : 'viewer';
}

/** Owner first, then 링크 추가, 승인 후 추가, 읽기 전용 - so who can add to the Collection is visible at a glance. */
const ROLE_ORDER: Record<BadgeKind, number> = { owner: 0, contributor: 1, submitter: 2, viewer: 3 };

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
          return t('shareSheet.belowPublicPermission');
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
  const label = kind === 'owner' ? t('collections.roleOwner') : t(roleLabelKey(kind));
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
  /** Takes the full width of its line (two equal halves). */
  readonly stretch?: boolean;
  /**
   * The lowest permission allowed (the public link's own level): anything below it is shown greyed
   * out and cannot be chosen.
   */
  readonly minimum?: InvitationRole | null;
  /**
   * Tapping an option below the minimum: it looks disabled but still hears the tap (never a native
   * disabled press), so the screen can say briefly why - the value itself never changes.
   */
  readonly onUnavailablePress?: () => void;
}

/** 읽기 전용 | 승인 후 추가 | 링크 추가 for one person about to be invited. The wire roles are never shown. */
function RoleToggle({ value, onChange, disabled = false, label, testID, stretch = false, minimum = null, onUnavailablePress }: RoleToggleProps) {
  const { t } = useTranslation();
  return (
    <View accessibilityLabel={t('shareSheet.permissionA11y', { name: label })} accessibilityRole="radiogroup" style={[styles.roleToggle, stretch && styles.roleToggleStretch]}>
      {ROLES.map(role => {
        const isSelected = value === role;
        const isBelowMinimum = minimum !== null && INVITATION_ROLE_RANK[role] < INVITATION_ROLE_RANK[minimum];
        const isDisabled = disabled || isBelowMinimum;
        return (
          <Pressable
            accessibilityRole="radio"
            accessibilityState={{ checked: isSelected, disabled: isDisabled }}
            // Below the minimum stays pressable on purpose: the tap only explains (see onUnavailablePress).
            disabled={disabled}
            hitSlop={3}
            key={role}
            onPress={() => {
              if (isBelowMinimum) {
                onUnavailablePress?.();
              } else if (!isSelected) {
                onChange(role);
              }
            }}
            style={[styles.roleOption, stretch && styles.roleOptionStretch, isSelected && styles.roleOptionSelected, disabled && styles.disabled]}
            testID={`${testID}-${role}`}
          >
            <Text
              numberOfLines={1}
              style={[styles.roleOptionLabel, isSelected && styles.roleOptionLabelSelected, isBelowMinimum && styles.roleOptionLabelUnavailable]}
            >
              {t(roleLabelKey(role))}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

interface SegmentOption<T extends string> {
  readonly key: T;
  readonly label: string;
}

/**
 * One row of equal segments - the tab bars inside a card (친구 | ID, 공유 중 | 초대 대기) and the public
 * link's 읽기 전용 | 링크 추가 가능 permission selector share this one look. It only ever chooses
 * within one card, never between the screen's independent ways of sharing.
 */
function Segmented<T extends string>({
  options,
  value,
  onChange,
  kind,
  disabled = false,
  testID,
  onReselect,
  accessibilityLabel,
}: {
  readonly options: readonly SegmentOption<T>[];
  readonly value: T;
  readonly onChange: (key: T) => void;
  /** Tapping the segment that is already selected - by default nothing happens. */
  readonly onReselect?: (key: T) => void;
  readonly kind: 'tabs' | 'radio';
  readonly disabled?: boolean;
  readonly testID: string;
  /** What the choice is about (e.g. 권한), announced with the group. */
  readonly accessibilityLabel?: string;
}) {
  return (
    <View accessibilityLabel={accessibilityLabel} accessibilityRole={kind === 'tabs' ? 'tablist' : 'radiogroup'} style={styles.segmented} testID={testID}>
      {options.map(option => {
        const isSelected = value === option.key;
        return (
          <Pressable
            accessibilityRole={kind === 'tabs' ? 'tab' : 'radio'}
            accessibilityState={kind === 'tabs' ? { selected: isSelected, disabled } : { checked: isSelected, disabled }}
            disabled={disabled}
            hitSlop={3}
            key={option.key}
            onPress={() => {
              if (!isSelected) {
                onChange(option.key);
              } else {
                onReselect?.(option.key);
              }
            }}
            style={[styles.segment, isSelected && styles.segmentSelected, disabled && styles.disabled]}
            testID={`${testID}-${option.key}`}
          >
            <Text numberOfLines={2} style={[styles.segmentLabel, isSelected && styles.segmentLabelSelected]}>
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/**
 * The 공용 컬렉션 설정 on/off: the same switch look as the 접근 비밀번호 card's - no OFF / ON words - but
 * driven by a Pressable around a purely visual, touch-less Switch. A native Switch flips itself on
 * touch BEFORE any JS runs, so with a confirmation in between (ON -> stop sharing?) it showed
 * ON -> OFF -> ON again. Here the Switch only ever shows the `value` it is given: a tap just reports
 * the wish (`onChange(!value)`), and the visual state moves only when the caller changes `value` -
 * after the confirmation and the request. Exposed as one switch (role, checked, label) with a 44dp target.
 */
function PublicToggle({
  value,
  onChange,
  disabled = false,
  label,
  testID,
}: {
  readonly value: boolean;
  readonly onChange: (next: boolean) => void;
  readonly disabled?: boolean;
  /** What is switched (e.g. 공용 컬렉션 설정), announced with the switch. */
  readonly label: string;
  readonly testID: string;
}) {
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="switch"
      accessibilityState={{ checked: value, disabled }}
      disabled={disabled}
      hitSlop={{ bottom: 4, top: 4 }}
      onPress={() => onChange(!value)}
      style={styles.publicToggle}
      testID={testID}
    >
      <View importantForAccessibility="no-hide-descendants" pointerEvents="none">
        <Switch disabled={disabled} value={value} />
      </View>
    </Pressable>
  );
}

function SectionCard({
  icon,
  title,
  count,
  trailing,
  titleAccessory,
  children,
  testID,
}: {
  readonly icon: ReactNode;
  readonly title: string;
  readonly count?: string;
  /** A control at the end of the header - e.g. the public link's on/off switch. */
  readonly trailing?: ReactNode;
  /** Right after the title text (e.g. an info button). */
  readonly titleAccessory?: ReactNode;
  readonly children: ReactNode;
  readonly testID: string;
}) {
  return (
    <View style={styles.card} testID={testID}>
      <View style={styles.cardHeader}>
        <View style={styles.cardIcon}>{icon}</View>
        {titleAccessory ? (
          <View style={styles.titleCluster}>
            <Text accessibilityRole="header" numberOfLines={2} style={[styles.cardTitle, styles.cardTitleInCluster]}>{title}</Text>
            {titleAccessory}
          </View>
        ) : (
          <Text accessibilityRole="header" numberOfLines={2} style={styles.cardTitle}>{title}</Text>
        )}
        {count !== undefined ? <Text style={[styles.cardCount, ltrTextStyle]} testID={`${testID}-count`}>{count}</Text> : null}
        {trailing}
      </View>
      {children}
    </View>
  );
}

/**
 * The one place for sharing a Collection (Owner only). The ways of sharing are independent and can
 * be used together, so each is its own card, always shown (never tabs that look like a choice):
 * - 공용 컬렉션 설정: the public link and its 권한 - [읽기 전용] (anyone with the link views, signed in
 *   or not) or [링크 추가 가능] (additionally, holders SIGNED IN to Juple may add their own links -
 *   never anonymously). "공유 중" on the card while the link is on.
 * - 친구 초대: [친구] | [ID] tabs feeding one batch of any size; each person gets 읽기 전용 (viewer)
 *   or 링크 추가 가능 (contributor); sent a few at a time, they must accept.
 * - 접근 비밀번호: one setting for both ways above (SharePasswordCard).
 * - 공유 상태: [공유 중 N] | [초대 대기 N] tabs of one-line rows with a role badge; changing the
 *   permission, removing and cancelling live behind each row's "⋯" menu.
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
  const { showNotificationToast } = useAppToast();
  /** 읽기 전용 tapped while the public link is 링크 추가: why it can't be given (nothing changes, nothing is sent). */
  const explainBelowPublicPermission = () => showNotificationToast(t('shareSheet.belowPublicPermission'));

  const [collection, setCollection] = useState<Collection | null>(null);
  const [share, setShare] = useState<CollectionShare | null>(null);
  const [participants, setParticipants] = useState<CollectionParticipants | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<{ readonly cause: unknown; readonly message: string; readonly canRetry: boolean } | null>(null);

  const [isManagingShare, setIsManagingShare] = useState(false);
  const [shareError, setShareError] = useState<string | null>(null);
  // Reported by the 공유 비밀번호 card below (Owner only).
  const [sharePasswordMode, setSharePasswordMode] = useState<SharePasswordMode | null>(null);
  const [isUnshareConfirmVisible, setIsUnshareConfirmVisible] = useState(false);
  // Shared with the participants popup: the same people, so the same List/Grid choice.
  const publicToggleBusyRef = useRef(false);
  // A public permission that someone below it stands in the way of: the Owner is asked whether to raise
  // them too (nothing changes until they say yes; no is "never mind" - the selector stays as it was).
  const [raiseRolesPrompt, setRaiseRolesPrompt] = useState<{ readonly permission: PublicSharePermission; readonly isStart: boolean } | null>(null);
  // 모든 사용자 읽기 전용/링크 추가 가능 chosen before the link exists; once it exists, the link's own permission rules.
  const [pendingPublicPermission, setPendingPublicPermission] = useState<PublicSharePermission>('read');
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
    return loaded;
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
    } catch (caughtError) {
      const isOwnerOnly = caughtError instanceof ApiError && (caughtError.kind === 'forbidden' || caughtError.kind === 'notFound');
      setLoadError({ cause: caughtError, message: isOwnerOnly ? t('collaboration.ownerOnly') : t('collaboration.loadFallback'), canRetry: !isOwnerOnly });
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


  const isOwnerView = participants?.canManage === true;
  const members = [...(participants?.participants ?? [])].sort(
    (left, right) => ROLE_ORDER[memberRoleOf(left.role)] - ROLE_ORDER[memberRoleOf(right.role)],
  );
  const pendingInvitations = participants?.pendingInvitations ?? [];
  /** How many people (members and still-pending invitations) of these lists are below this permission's minimum. */
  const countBelowIn = (lists: CollectionParticipants | null, permission: PublicSharePermission): number => {
    const minimum = minimumRoleForPublicPermission(permission);
    if (minimum === null || lists === null) {
      return 0;
    }
    const isBelow = (role: InvitationRole) => INVITATION_ROLE_RANK[role] < INVITATION_ROLE_RANK[minimum];
    return (
      lists.participants.filter(member => member.role !== 'owner' && isBelow(invitationRoleOf(member.role))).length
      + lists.pendingInvitations.filter(invitation => isBelow(invitationRoleOf(invitation.role))).length
    );
  };
  const countBelowMinimum = (permission: PublicSharePermission): number => countBelowIn(participants, permission);
  const hasRoleMismatch = (permission: PublicSharePermission): boolean => countBelowMinimum(permission) > 0;

  // ---------- 모든 사용자 (public link: 읽기 or 작성) ----------

  const publicPermission: PublicSharePermission = share ? share.permission ?? 'read' : pendingPublicPermission;
  // While the link is on, nobody may be below its level (승인 후 추가 or 링크 추가); under 읽기 전용 each keeps their own choice.
  const minimumRole: InvitationRole | null = share ? minimumRoleForPublicPermission(share.permission ?? 'read') : null;
  // Still protected by the Owner's lock password for the recipients it already had (legacy): no new
  // recipient - neither a new link nor an invitation - until the Owner sets this Collection's own
  // share password or removes the protection in the card below. The server refuses it as well.
  const needsSharePasswordMigration = sharePasswordMode === 'legacyCommonLock';
  // Off → on is held back while it would be refused; on → off (stopping) is always possible.
  const isPublicToggleDisabled = isManagingShare || (!share && needsSharePasswordMigration);

  /** Keeps the Juple ID field and its result above the keyboard (edge-to-edge Android no longer resizes). */
  const scrollToIdArea = () => {
    setTimeout(() => {
      if (idAreaRef.current && contentRef.current) {
        idAreaRef.current.measureLayout(contentRef.current, (_x, y) => scrollRef.current?.scrollTo({ y: Math.max(0, y - spacing.lg), animated: true }));
      }
    }, 250);
  };

  /**
   * Turns the public link on (isStart) or changes its permission. raiseLowerRoles is the Owner's yes to
   * "also raise the people below it": the server then does both in one transaction. Without it, the
   * server's refusal (someone was added or lowered since the lists were read) is not an error shown
   * to the Owner - the lists are refreshed and the same question is asked.
   */
  const applyPublicShare = async (permission: PublicSharePermission, isStart: boolean, raiseLowerRoles: boolean) => {
    setIsManagingShare(true);
    setShareError(null);
    // The plain call is exactly what it always was; only a confirmed raise adds the option.
    const callServer = async (raise: boolean) =>
      setShare(
        isStart
          ? raise
            ? await enableCollectionShare(authenticatedRequest, collectionId, permission, { raiseLowerRoles: true })
            : await enableCollectionShare(authenticatedRequest, collectionId, permission)
          : raise
            ? await setCollectionSharePermission(authenticatedRequest, collectionId, permission, { raiseLowerRoles: true })
            : await setCollectionSharePermission(authenticatedRequest, collectionId, permission),
      );
    const isMismatch = (error: unknown) =>
      permission !== 'read' && error instanceof ApiError && error.kind === 'conflict' && error.code === 'publicSharePermissionMismatch';
    // The lists show what the server has now - never the roles from before the change.
    const refreshLists = () => loadParticipants().catch(() => null);
    try {
      await callServer(raiseLowerRoles);
      if (raiseLowerRoles) {
        await refreshLists();
      }
    } catch (caughtError) {
      if (!isMismatch(caughtError)) {
        setShareError(getShareManagementErrorMessage(caughtError, t, permission));
      } else {
        // Someone lower stands in the way (added or lowered since the lists were read). Decide from the
        // server's own state, and never by changing people one by one from here: the raise is the
        // server's single transaction or it does not happen.
        const fresh = await refreshLists();
        if (fresh === null) {
          setShareError(t('collections.errorShareManagementFallback'));
        } else if (countBelowIn(fresh, permission) > 0) {
          setRaiseRolesPrompt({ permission, isStart });
        } else {
          // Nobody is in the way any more: the plain change is exactly right.
          try {
            await callServer(false);
          } catch (retryError) {
            if (isMismatch(retryError)) {
              setRaiseRolesPrompt({ permission, isStart });
            } else {
              setShareError(getShareManagementErrorMessage(retryError, t, permission));
            }
          }
        }
      }
    } finally {
      setIsManagingShare(false);
    }
  };

  /** 공유 시작: only this explicit action creates (or, idempotently, returns) the public link. */
  const startPublicShare = async () => {
    if (isManagingShare || publicToggleBusyRef.current) {
      return;
    }
    if (hasRoleMismatch(pendingPublicPermission)) {
      setRaiseRolesPrompt({ permission: pendingPublicPermission, isStart: true });
      return;
    }
    // Rapid taps in one frame must not send two enable requests (state would still read "idle").
    publicToggleBusyRef.current = true;
    try {
      await applyPublicShare(pendingPublicPermission, true, false);
    } finally {
      publicToggleBusyRef.current = false;
    }
  };

  const stopPublicShare = async () => {
    if (isManagingShare || publicToggleBusyRef.current) {
      return;
    }
    publicToggleBusyRef.current = true;
    setIsManagingShare(true);
    setShareError(null);
    try {
      await revokeCollectionShare(authenticatedRequest, collectionId);
      setShare(null);
    } catch (caughtError) {
      setShareError(getShareManagementErrorMessage(caughtError, t, null));
    } finally {
      publicToggleBusyRef.current = false;
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
      // Someone below it: ask first. The selector shows the link's own permission, so it only moves
      // once the Owner agrees - saying no leaves it exactly where it was.
      setRaiseRolesPrompt({ permission, isStart: false });
      return;
    }
    await applyPublicShare(permission, false, false);
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
    setDrafts(previous => {
      const added = friends
        .filter(friend => !previous.some(draft => draft.jupleId === friend.jupleId))
        // Only the friend's own display name - never the private note the picker shows.
        .map<InviteDraft>(friend => ({
          jupleId: friend.jupleId,
          displayName: friend.displayName,
          profileImageUrl: friend.profileImageUrl,
          profileImageVersion: friend.profileImageVersion,
          role: minimumRole ?? 'viewer',
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
    setDrafts(previous => [
      ...previous,
      { jupleId: person.jupleId, displayName: person.displayName ?? null, profileImageUrl: person.profileImageUrl, profileImageVersion: person.profileImageVersion, role: raiseToMinimum(idRole, minimumRole), status: 'ready', message: null },
    ]);
    setIdInput('');
    setIdRole('viewer');
    setIdLookup({ status: 'idle', person: null, message: null });
  };

  const setDraftRole = (jupleId: string, role: InvitationRole) => {
    if (raiseToMinimum(role, minimumRole) !== role) {
      return;
    }
    setActionError(null);
    setDrafts(previous => previous.map(draft => (draft.jupleId === jupleId ? { ...draft, role, status: 'ready', message: null } : draft)));
  };

  const removeDraft = (jupleId: string) => setDrafts(previous => previous.filter(draft => draft.jupleId !== jupleId));

  /**
   * Sends the whole batch - friends and Juple IDs alike - one invitation per person, at most
   * INVITE_CONCURRENCY at a time (the server has no batch endpoint and rate-limits per identity).
   * Never below the public link's level - a row showing less is raised to it, never sent as is. Sent
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
    setDrafts(previous => previous.map(draft => ({ ...draft, status: 'sending', message: null })));

    const results = await runWithConcurrency(batch, INVITE_CONCURRENCY, draft =>
      inviteCollaborator(authenticatedRequest, collectionId, draft.jupleId, raiseToMinimum(draft.role, minimumRole)),
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
    // No success sentence: the sent people leave the list and appear under 초대 대기 - that is the
    // feedback. A failure stays on its own row with its reason (above).
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
    if (raiseToMinimum(role, minimumRole) !== role) {
      setActionError(t('shareSheet.belowPublicPermission'));
      return;
    }
    if (person.kind === 'member') {
      runAction(`role-${person.jupleId}`, () => changeCollaboratorRole(authenticatedRequest, collectionId, person.jupleId, role));
    } else {
      runAction(`pending-role-${person.invitationId}`, () => changeInvitationRole(authenticatedRequest, collectionId, person.invitationId, role));
    }
  };

  /** The "⋯" menu of one row: switch to each other permission at or above the public link's level, then remove / cancel. */
  const menuActions: readonly ActionMenuDialogAction[] = managed
    ? [
        ...ROLES
          .filter(role => role !== managed.role && raiseToMinimum(role, minimumRole) === role)
          .map(role => ({
            label: t(role === 'viewer' ? 'shareSheet.changeToRead' : role === 'submitter' ? 'shareSheet.changeToSubmit' : 'shareSheet.changeToWrite'),
            icon: role === 'viewer' ? EyeIcon : role === 'submitter' ? CheckIcon : PlusIcon,
            onPress: () => {
              const person = managed;
              setManaged(null);
              changeRole(person, role);
            },
          })),
        managed.kind === 'member'
          ? {
              label: t('shareSheet.removeMember'),
              icon: UserMinusIcon,
              destructive: true,
              onPress: () => {
                const person = managed;
                setManaged(null);
                setPendingRemoval({ jupleId: person.jupleId, label: person.label });
              },
            }
          : {
              label: t('shareSheet.cancelInvitation'),
              icon: CloseIcon,
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

  /** The person a permission is being chosen for: [avatar] Display Name @JupleID, shown right above 권한. */
  const selectedPersonSummary = (person: { readonly jupleId: string; readonly displayName?: string | null; readonly profileImageUrl?: string | null; readonly profileImageVersion?: string | null }) => (
    <View style={styles.selectedPerson} testID={`invite-selected-person-${person.jupleId}`}>
      <UserAvatar displayName={person.displayName} imageUrl={person.profileImageUrl} imageVersion={person.profileImageVersion} jupleId={person.jupleId} size={STATUS_AVATAR_SIZE} />
      {personText(person)}
    </View>
  );

  const { openProfile, profileModal } = usePersonProfile();
  /** A person's avatar - decoration only: the WHOLE row (see personRowProps) opens the profile / friend info, never a management action. */
  const avatarButton = (person: PersonProfileTarget & { readonly displayName?: string | null }, testID: string) => (
    <View testID={testID}>
      <UserAvatar displayName={person.displayName} imageUrl={person.profileImageUrl} imageVersion={person.profileImageVersion} jupleId={person.jupleId} size={STATUS_AVATAR_SIZE} />
    </View>
  );
  /** Row-level tap: opens the person. The explicit ⋯ button inside is its own Pressable, so it never also triggers this. */
  const personRowProps = (person: PersonProfileTarget & { readonly displayName?: string | null }) => ({
    accessibilityLabel: `${personLabel(person)}, ${t('friends.personTitle')}`,
    accessibilityRole: 'button' as const,
    onPress: () => openProfile(person),
  });

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
      <KeyboardSafeView style={styles.flex}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" ref={scrollRef}>
        {isLoading && !participants ? <ActivityIndicator style={styles.loading} /> : null}
        {loadError ? (
          <LoadFailureState error={loadError.cause} message={loadError.message} onRetry={loadError.canRetry ? () => { load(); } : undefined} testID="share-load-error" />
        ) : null}

        {participants ? (
          <View ref={contentRef} testID="share-unified">
            {/* A. 공용 컬렉션 설정: [ON/OFF switch] at the end of the header - the setting only. Passing the
                link on is its own compact action at the card's bottom end, well away from the switch
                (a tap meant for the switch must never share). The URL itself is not shown. */}
            <SectionCard
              icon={<GlobeIcon color={colors.textSecondary} size={16} />}
              testID="share-all-users"
              title={t('shareSheet.allUsersTitle')}
              titleAccessory={<InfoCallout accessibilityLabel={t('shareSheet.publicInfoA11y')} message={t('shareSheet.publicInfo')} testID="share-public-info" />}
              trailing={
                <View style={styles.headerTrailing}>
                  {/* On creates the link (the server's own enable), off stops it after a confirmation. */}
                  <PublicToggle
                    disabled={isPublicToggleDisabled}
                    label={t('shareSheet.allUsersTitle')}
                    onChange={isOn => {
                      if (isOn) {
                        startPublicShare();
                      } else {
                        setIsUnshareConfirmVisible(true);
                      }
                    }}
                    testID="share-public-toggle"
                    value={share !== null}
                  />
                  {/* Passing the link on, only while it is on: right next to the switch (its end side). While
                      it is off nothing is reserved for it, so the switch sits at the card's end edge and moves
                      toward the start as the share icon appears. */}
                  {share ? (
                    <Pressable
                      accessibilityLabel={t('shareSheet.shareLink')}
                      accessibilityRole="button"
                      onPress={shareLink}
                      style={styles.headerShare}
                      testID="share-link-action"
                    >
                      <ShareIcon color={colors.textPrimary} size={20} />
                    </Pressable>
                  ) : null}
                </View>
              }
            >
              <View style={styles.field}>
                {/* No separate 권한 heading: the options themselves (읽기 전용 / 승인 후 추가 / 링크 추가) say what this is. */}
                <Segmented
                  accessibilityLabel={t('shareSheet.permissionLabel')}
                  disabled={isManagingShare}
                  kind="radio"
                  onChange={changePublicPermission}
                  // Re-choosing the current permission (e.g. 읽기 전용 after a refused 링크 추가) clears
                  // that attempt's reason - it never stays under a choice it was not about.
                  onReselect={() => setShareError(null)}
                  options={[
                    { key: 'read', label: t('shareSheet.permissionRead') },
                    { key: 'submit', label: t('shareSheet.permissionSubmit') },
                    { key: 'write', label: t('shareSheet.permissionWrite') },
                  ]}
                  testID="share-all-users-permission"
                  value={publicPermission}
                />
              </View>
              <Text style={styles.help} testID="share-all-users-description">
                {publicPermission === 'write'
                  ? t('shareSheet.allUsersWriteDescription')
                  : publicPermission === 'submit'
                    ? t('shareSheet.allUsersSubmitDescription')
                    : t('shareSheet.allUsersDescription')}
              </Text>
              {!share ? (
                <>
                  {needsSharePasswordMigration ? (
                    <View style={styles.noticeBox} testID="share-public-migration-required">
                      <Text style={styles.noticeText}>{t('collections.sharePasswordLegacyNotice')}</Text>
                    </View>
                  ) : null}
                </>
              ) : null}
              {collection && isCollectionLocked(collection) ? (
                <Text style={styles.help} testID="share-locked-note">{t('shareSheet.lockedLinkNote')}</Text>
              ) : null}
              {shareError ? <Text style={styles.error}>{shareError}</Text> : null}
            </SectionCard>

            {/* B. 친구 초대: [친구] | [ID] feeding one batch of people, each with their own permission. */}
            <SectionCard icon={<UserIcon color={colors.textSecondary} size={16} />} testID="share-invite" title={t('shareSheet.inviteTitle')}>
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
              {inviteTab === 'friends' ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityState={{ disabled: inviteDisabled }}
                  disabled={inviteDisabled}
                  hitSlop={2}
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
                    <SearchIconButton
                      accessibilityLabel={t('collaboration.find')}
                      disabled={inviteDisabled || !idInput.trim()}
                      isLoading={idLookup.status === 'lookingUp'}
                      onPress={findById}
                      testID="id-invite-find"
                    />
                  </View>
                  {idLookup.status === 'found' && idLookup.person ? (
                    // Who and "+" on one line, then 권한 over their permission - the same shape as a
                    // person already in the list below.
                    <View style={styles.personRow} testID="id-invite-person">
                      <View style={styles.rowLine}>
                        <View style={styles.personRowText}>{selectedPersonSummary(idLookup.person)}</View>
                        <Pressable
                          accessibilityLabel={t('shareSheet.addPersonToInviteList', { name: personLabel(idLookup.person) })}
                          accessibilityRole="button"
                          onPress={addFoundPerson}
                          style={styles.addButton}
                          testID="id-invite-add"
                        >
                          <PlusIcon color={colors.surface} size={20} strokeWidth={2.25} />
                        </Pressable>
                      </View>
                      <View style={styles.field} testID="id-invite-permission">
                        <Text style={styles.fieldLabel}>{t('shareSheet.permissionLabel')}</Text>
                        <RoleToggle
                          label={personLabel(idLookup.person)}
                          minimum={minimumRole}
                          onChange={role => {
                            setActionError(null);
                            setIdRole(role);
                          }}
                          onUnavailablePress={explainBelowPublicPermission}
                          stretch
                          testID="id-invite-role"
                          value={raiseToMinimum(idRole, minimumRole)}
                        />
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
                    <Text numberOfLines={1} style={styles.batchCount} testID="share-invite-list-count">{t('shareSheet.selectedCount', { count: drafts.length })}</Text>
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
                    return (
                      <View key={draft.jupleId} style={[styles.draftRow, index > 0 && styles.listRowDivider]} testID={`draft-${draft.jupleId}`}>
                        {/* Who and their × on one line; then 권한 over that person's own choice, full
                            width - the same stacked shape on every screen width. */}
                        <View style={styles.rowLine}>
                          <View style={styles.personRowText}>{selectedPersonSummary(draft)}</View>
                          {removeButton}
                        </View>
                        <View style={styles.field} testID={`draft-permission-${draft.jupleId}`}>
                          <Text style={styles.fieldLabel}>{t('shareSheet.permissionLabel')}</Text>
                          <RoleToggle
                            disabled={draft.status === 'sending'}
                            label={personLabel(draft)}
                            minimum={minimumRole}
                            onChange={role => setDraftRole(draft.jupleId, role)}
                            onUnavailablePress={explainBelowPublicPermission}
                            stretch
                            testID={`draft-role-${draft.jupleId}`}
                            value={raiseToMinimum(draft.role, minimumRole)}
                          />
                        </View>
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
            </SectionCard>
            {actionError ? <Text style={[styles.error, styles.actionError]} testID="share-action-error">{actionError}</Text> : null}

            {/* C. 접근 비밀번호: one setting for both ways of sharing above, separate from both - and
                from the Owner's own Collection lock. Owner only. */}
            {isOwnerView ? (
              <SharePasswordCard authenticatedRequest={authenticatedRequest} collectionId={collectionId} onModeChange={setSharePasswordMode} />
            ) : null}

            {/* D. 공유 상태: [공유 중 N] | [초대 대기 N] - pending invitations are not always spread out. */}
            <View ref={statusCardRef}>
            <SectionCard
              icon={<PeopleIcon color={colors.textSecondary} size={16} />}
              testID="share-status"
              title={t('shareSheet.statusTitle')}
            >
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
                      <Pressable
                        {...personRowProps({ jupleId: member.jupleId, displayName: member.displayName, profileImageUrl: member.profileImageUrl, profileImageVersion: member.profileImageVersion, isSelf: member.isMe })}
                        key={member.jupleId}
                        style={[styles.listRow, styles.listRowMain, index > 0 && styles.listRowDivider]}
                        testID={`participant-${member.jupleId}`}
                      >
                        {avatarButton({ jupleId: member.jupleId, displayName: member.displayName, profileImageUrl: member.profileImageUrl, profileImageVersion: member.profileImageVersion, isSelf: member.isMe }, `participant-avatar-${member.jupleId}`)}
                        {kind === 'owner' ? <OwnerCrown /> : null}
                        {personText(member, label)}
                        <RoleBadge kind={kind} testID={`participant-role-${member.jupleId}`} />
                        {kind !== 'owner' && isOwnerView
                          ? moreButton(personLabel(member), () =>
                              setManaged({ kind: 'member', jupleId: member.jupleId, label: personLabel(member), role: kind }), `member-actions-${member.jupleId}`)
                          : null}
                      </Pressable>
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
                        <Pressable
                          {...personRowProps({ jupleId: invitation.jupleId, displayName: invitation.displayName, profileImageUrl: invitation.profileImageUrl, profileImageVersion: invitation.profileImageVersion })}
                          key={invitation.invitationId}
                          style={[styles.listRow, styles.listRowMain, index > 0 && styles.listRowDivider]}
                          testID={`pending-${invitation.invitationId}`}
                        >
                          {avatarButton({ jupleId: invitation.jupleId, displayName: invitation.displayName, profileImageUrl: invitation.profileImageUrl, profileImageVersion: invitation.profileImageVersion }, `pending-avatar-${invitation.invitationId}`)}
                          <View style={styles.personText}>
                            <Text numberOfLines={1} style={styles.personName}>{personLabel(invitation)}</Text>
                            <Text numberOfLines={1} style={styles.pendingStatus}>
                              {invitation.displayName ? `${formatJupleId(invitation.jupleId)} · ` : ''}{t('shareSheet.pendingStatus')}
                            </Text>
                          </View>
                          <RoleBadge kind={role} testID={`pending-role-${invitation.invitationId}`} />
                          {moreButton(personLabel(invitation), () =>
                            setManaged({ kind: 'pending', invitationId: invitation.invitationId, label: personLabel(invitation), role }), `pending-actions-${invitation.invitationId}`)}
                        </Pressable>
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
      </KeyboardSafeView>
      <FriendPickerModal
        authenticatedRequest={authenticatedRequest}
        onClose={() => setIsFriendPickerVisible(false)}
        onConfirm={addFriends}
        unavailable={unavailableFriends}
        visible={isFriendPickerVisible}
      />
      {profileModal}
      <ActionMenuDialog
        actions={menuActions}
        cancelLabel={t('common.cancel')}
        onCancel={() => setManaged(null)}
        visible={managed !== null}
      />
      <ConfirmDialog
        cancelLabel={t('common.cancel')}
        confirmLabel={t('shareSheet.raiseRolesConfirm')}
        destructive={false}
        message={raiseRolesPrompt
          ? t('shareSheet.raiseRolesMessage', { count: countBelowMinimum(raiseRolesPrompt.permission), permission: t(publicPermissionLabelKey(raiseRolesPrompt.permission)) })
          : ''}
        onCancel={() => setRaiseRolesPrompt(null)}
        onConfirm={() => {
          const prompt = raiseRolesPrompt;
          setRaiseRolesPrompt(null);
          if (prompt) {
            applyPublicShare(prompt.permission, prompt.isStart, true).catch(() => undefined);
          }
        }}
        title={t('shareSheet.raiseRolesTitle')}
        visible={raiseRolesPrompt !== null}
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

// Role badges: 소유자 in the soft amber tile pair, 링크 추가 in the brand tint, 승인 후 추가 brand text
// on the neutral tile, 읽기 전용 neutral - existing tokens only.
const badgeStyles = StyleSheet.create({
  owner: { backgroundColor: categoryTilePalette[2].background },
  contributor: { backgroundColor: colors.brandSoft },
  submitter: { backgroundColor: colors.surfaceMuted },
  viewer: { backgroundColor: colors.surfaceMuted },
});

const badgeLabelStyles = StyleSheet.create({
  owner: { color: categoryTilePalette[2].icon },
  contributor: { color: colors.brand },
  submitter: { color: colors.brand },
  viewer: { color: colors.textSecondary },
});

/** The selected segment of every selector here: raised white, subtle neutral outline - never brand blue. */
const selectedSegment = {
  backgroundColor: colors.surface,
  borderColor: colors.inputBorder,
  elevation: 1,
  shadowColor: '#000000',
  shadowOffset: { height: 1, width: 0 },
  shadowOpacity: 0.06,
  shadowRadius: 2,
} as const;

const styles = StyleSheet.create({
  safeArea: { backgroundColor: colors.background, flex: 1 },
  content: { alignSelf: 'center', maxWidth: CONTENT_MAX_WIDTH, padding: spacing.lg, width: '100%' },
  // A section card: a light neutral 1px outline (the app's own soft card border) so each section
  // reads as its own block on the screen background, without a heavy rule. Kept compact: the four
  // cards share one screen, so none of them is a tall block of its own.
  card: {
    backgroundColor: colors.surface,
    borderColor: colors.inputBorder,
    borderRadius: radii.lg,
    borderWidth: 1,
    gap: spacing.sm,
    marginBottom: spacing.sm + 2,
    paddingHorizontal: spacing.md + 2,
    paddingVertical: spacing.md,
  },
  // A small label right on top of its control (권한 over a permission choice).
  field: { gap: spacing.xs },
  fieldLabel: { color: colors.textSecondary, fontSize: 12, fontWeight: '600' },
  // [ON/OFF] [switch] at the end of a card header: a tight pair, so the title keeps its one line
  // even at 360dp. A long translation of the state shortens itself rather than push the switch out.
  // [share] [OFF | ON]: never shrinks (the title wraps instead) and keeps a wide gap between its two controls.
  headerTrailing: { alignItems: 'center', flexDirection: 'row', flexShrink: 0, gap: spacing.xs },
  headerShare: { alignItems: 'center', justifyContent: 'center', minHeight: minTouchTarget, minWidth: minTouchTarget },
  publicToggle: { alignItems: 'center', justifyContent: 'center', minHeight: minTouchTarget },
  actionError: { marginBottom: spacing.sm + 2 },
  cardHeader: { alignItems: 'center', flexDirection: 'row', gap: spacing.sm },
  cardIcon: { alignItems: 'center', backgroundColor: colors.surfaceMuted, borderRadius: 12, height: 24, justifyContent: 'center', width: 24 },
  titleCluster: { alignItems: 'center', flex: 1, flexDirection: 'row', minWidth: 0 },
  cardTitleInCluster: { flex: 0, flexShrink: 1 },
  cardTitle: { color: colors.textPrimary, flex: 1, flexShrink: 1, fontSize: 15, fontWeight: '600' },
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
  segment: {
    alignItems: 'center',
    borderColor: 'transparent',
    borderRadius: radii.md,
    borderWidth: 1,
    flex: 1,
    flexDirection: 'row',
    gap: spacing.xs + 2,
    justifyContent: 'center',
    minHeight: minTouchTarget - 6,
    minWidth: 0,
    paddingHorizontal: spacing.sm,
  },
  // Every choice on this screen (권한, 친구 | ID, a person's permission, 공유 중 | 초대 대기) is a
  // neutral selection - a raised white segment with the strong text color, never the brand blue,
  // so it never reads as a button to press. Only the actions (공유 시작, 초대 보내기, …) are blue.
  segmentSelected: { ...selectedSegment },
  segmentLabel: { color: colors.textSecondary, flexShrink: 1, fontSize: 14, fontWeight: '600', textAlign: 'center' },
  segmentLabelSelected: { color: colors.textPrimary, fontWeight: '700' },
  idArea: { gap: spacing.sm },
  batch: { borderTopColor: colors.divider, borderTopWidth: 1, gap: spacing.xs, marginTop: spacing.xs, paddingTop: spacing.sm },
  batchHeader: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
  batchTitle: { color: colors.textPrimary, flexShrink: 1, fontSize: 13, fontWeight: '600' },
  batchCount: { color: colors.textSecondary, fontSize: 12, fontWeight: '600' },
  badgeLabel: { fontSize: 12, fontWeight: '700' },
  // The link's share action, alone at the card's bottom end (a 44dp target, no box).
  shareActionRow: { alignItems: 'flex-end' },
  shareAction: { alignItems: 'center', flexDirection: 'row', gap: spacing.xs, minHeight: minTouchTarget, minWidth: minTouchTarget, paddingHorizontal: spacing.sm },
  shareActionLabel: { color: colors.textPrimary, fontSize: 14, fontWeight: '600' },
  buttonRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  flexButton: { flexBasis: 140, flexGrow: 1 },
  noticeBox: { backgroundColor: colors.surfaceMuted, borderRadius: radii.md, gap: spacing.xs, padding: spacing.md },
  noticeText: { color: colors.textPrimary, fontSize: 13, fontWeight: '600' },
  // 40dp to look at; its hitSlop keeps 44dp to touch.
  outlineButton: {
    alignItems: 'center',
    borderColor: colors.brand,
    borderRadius: radii.md,
    borderWidth: 1,
    justifyContent: 'center',
    minHeight: minTouchTarget - 4,
    paddingHorizontal: spacing.md,
  },
  outlineButtonLabel: { color: colors.brand, fontSize: 14, fontWeight: '600', textAlign: 'center' },
  help: { color: colors.textSecondary, fontSize: 13, lineHeight: 18 },
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
  // The Juple ID search result: who and "+" on one line, then 권한 over their permission.
  personRow: {
    backgroundColor: colors.background,
    borderRadius: radii.md,
    gap: spacing.xs + 2,
    padding: spacing.sm,
  },
  personRowText: { flex: 1, minWidth: 0 },
  selectedPerson: { alignItems: 'center', flexDirection: 'row', gap: spacing.sm, minWidth: 0 },
  inlineAction: { alignSelf: 'flex-start', justifyContent: 'center', minHeight: minTouchTarget },
  inlineActionLabel: { color: colors.brand, fontSize: 14, fontWeight: '700' },
  listRow: { gap: spacing.xs, paddingVertical: spacing.xs + 2 },
  // A person to invite: who, then 권한 with their choice - 8dp above and below, 6dp between.
  draftRow: { gap: spacing.xs + 2, paddingVertical: spacing.sm },
  // One line, never wrapping: the name gives way (ellipsis) before a badge or button would drop.
  listRowMain: { alignItems: 'center', flexDirection: 'row', gap: spacing.sm },
  rowLine: { alignItems: 'center', flexDirection: 'row', gap: spacing.sm },
  listRowDivider: { borderTopColor: colors.divider, borderTopWidth: 1 },
  personText: { flex: 1, minWidth: 0 },
  personName: { color: colors.textPrimary, fontSize: 14, fontWeight: '600' },
  jupleId: { color: colors.textSecondary, fontSize: 12, fontWeight: '600', letterSpacing: 1 },
  pendingStatus: { color: colors.textSecondary, fontSize: 12 },
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
  // 38dp to look at; the hitSlop on each option (see RoleToggle) keeps the touch target at 44dp.
  roleOption: {
    alignItems: 'center',
    borderColor: 'transparent',
    borderRadius: radii.md,
    borderWidth: 1,
    flexShrink: 1,
    justifyContent: 'center',
    minHeight: minTouchTarget - 6,
    minWidth: 0,
    paddingHorizontal: spacing.sm,
  },
  roleOptionStretch: { flexBasis: 0, flexGrow: 1 },
  roleOptionSelected: { ...selectedSegment },
  roleOptionLabel: { color: colors.textSecondary, fontSize: 14, fontWeight: '600' },
  roleOptionLabelSelected: { color: colors.textPrimary, fontWeight: '700' },
  // Below the public link's 링크 추가: visibly unavailable - faint, struck through.
  roleOptionLabelUnavailable: { color: colors.border, textDecorationLine: 'line-through' },
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
