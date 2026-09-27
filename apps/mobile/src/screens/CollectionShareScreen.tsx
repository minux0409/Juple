import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useCallback, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { ActivityIndicator, KeyboardAvoidingView, Pressable, ScrollView, type ScrollViewInstance, StyleSheet, Text, TextInput, View, type ViewInstance } from 'react-native';
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
import { isCollectionLockedError } from '../collections/useCollectionItems';
import { runWithConcurrency } from '../collections/runWithConcurrency';
import { FriendPickerModal, type FriendUnavailableReason } from '../friends/FriendPickerModal';
import type { Friend } from '../friends/api/friendsApi';
import { ActionMenuDialog, type ActionMenuDialogAction } from '../components/ActionMenuDialog';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { StackScreenSafeArea } from '../components/StackScreenSafeArea';
import { GlobeIcon } from '../icons/GlobeIcon';
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

/** While 모든 사용자 is on, every specific person gets exactly this role (a server rule too). */
export function roleForPublicPermission(permission: PublicSharePermission): InvitationRole {
  return permission === 'write' ? 'contributor' : 'viewer';
}

/** A person waiting in the invitation batch - picked from friends or found by Juple ID - with their own 보기만/링크 추가. */
interface InviteDraft {
  readonly jupleId: string;
  readonly displayName: string | null;
  readonly role: InvitationRole;
  readonly status: 'ready' | 'sending' | 'error';
  readonly message: string | null;
}

type BadgeKind = 'owner' | InvitationRole;

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

/** Owner first, then 링크 추가, then 보기만 - so who can add to the Collection is visible at a glance. */
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

function getShareManagementErrorMessage(error: unknown, t: TFunction): string {
  if (isCollectionLockedError(error)) {
    return t('collections.lockRequiredForAction');
  }
  if (error instanceof ApiError) {
    if (error.kind === 'unauthorized') {
      return t('errors.unauthorized');
    }
    if (error.kind === 'conflict' && (error.code === 'publicSharePermissionMismatch' || error.code === 'collaborationActive')) {
      return t('shareSheet.permissionMismatch');
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
}

/** 보기만 | 링크 추가 for one person about to be invited. The wire roles (viewer/contributor) are never shown. */
function RoleToggle({ value, onChange, disabled = false, label, testID }: RoleToggleProps) {
  const { t } = useTranslation();
  return (
    <View accessibilityLabel={t('shareSheet.permissionA11y', { name: label })} accessibilityRole="radiogroup" style={styles.roleToggle}>
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
            style={[styles.roleOption, isSelected && styles.roleOptionSelected, disabled && styles.disabled]}
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

/** Shown instead of RoleToggle while 모든 사용자 is on: the person gets exactly the link's permission. */
function FixedRoleBadge({ role, testID }: { readonly role: InvitationRole; readonly testID: string }) {
  const { t } = useTranslation();
  return (
    <View style={styles.fixedRole} testID={testID}>
      <Text numberOfLines={2} style={styles.fixedRoleLabel}>
        {t('shareSheet.fixedByAllUsers', { permission: role === 'contributor' ? t('shareSheet.permissionWrite') : t('shareSheet.permissionRead') })}
      </Text>
    </View>
  );
}

interface SegmentOption<T extends string> {
  readonly key: T;
  readonly label: string;
}

/**
 * One row of equal segments - the tab bars (친구 | ID, 공유 중 | 초대 대기) and the 모든 사용자
 * 읽기 | 작성 selector share this one look.
 */
function Segmented<T extends string>({
  options,
  value,
  onChange,
  kind,
  disabled = false,
  testID,
}: {
  readonly options: readonly SegmentOption<T>[];
  readonly value: T;
  readonly onChange: (key: T) => void;
  readonly kind: 'tabs' | 'radio';
  readonly disabled?: boolean;
  readonly testID: string;
}) {
  return (
    <View accessibilityRole={kind === 'tabs' ? 'tablist' : 'radiogroup'} style={styles.segmented} testID={testID}>
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
              }
            }}
            style={[styles.segment, isSelected && styles.segmentSelected, disabled && styles.disabled]}
            testID={`${testID}-${option.key}`}
          >
            <Text numberOfLines={1} style={[styles.segmentLabel, isSelected && styles.segmentLabelSelected]}>{option.label}</Text>
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
 * The one place for sharing a Collection (Owner only) - one screen, three areas, so it never grows
 * into a long column of cards:
 * - 모든 사용자: the public link, [보기만] (anyone with the link views, signed in or not) or
 *   [링크 추가] (additionally, holders SIGNED IN to Juple may add their own links - never anonymously).
 * - 초대하기: [친구] | [ID] tabs feeding one batch of any size; each person gets 보기만 (viewer) or
 *   링크 추가 (contributor); sent a few at a time, they must accept.
 * - 공유 상태: [공유 중 N] | [초대 대기 N] tabs of compact rows with a role badge; changing the
 *   permission, removing and cancelling live behind each row's "⋯" menu.
 * While 모든 사용자 is on, every specific person has exactly its permission (a server rule): the
 * per-person choice is fixed to it, and turning the link on or changing its permission is refused
 * while someone has a different one - nothing is ever changed automatically. The lists refresh on
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
  const [isUnshareConfirmVisible, setIsUnshareConfirmVisible] = useState(false);
  // 모든 사용자 읽기/작성 chosen before the link exists; once it exists, the link's own permission rules.
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

  const isOwnerView = participants?.canManage === true;
  const members = [...(participants?.participants ?? [])].sort(
    (left, right) => ROLE_ORDER[memberRoleOf(left.role)] - ROLE_ORDER[memberRoleOf(right.role)],
  );
  const pendingInvitations = participants?.pendingInvitations ?? [];
  /** Someone (member or still-pending invitation) whose role differs from what this permission requires. */
  const hasRoleMismatch = (permission: PublicSharePermission): boolean => {
    const required = roleForPublicPermission(permission);
    return (
      members.some(member => member.role !== 'owner' && memberRoleOf(member.role) !== required)
      || pendingInvitations.some(invitation => invitationRoleOf(invitation.role) !== required)
    );
  };

  // ---------- 모든 사용자 (public link: 읽기 or 작성) ----------

  const publicPermission: PublicSharePermission = share ? share.permission ?? 'read' : pendingPublicPermission;
  // While the link is on, every specific person gets exactly its role.
  const lockedRole: InvitationRole | null = share ? roleForPublicPermission(share.permission ?? 'read') : null;
  const isPublicBlocked = !share && hasRoleMismatch(pendingPublicPermission);

  const showMembers = () => {
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
      setShareError(getShareManagementErrorMessage(caughtError, t));
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
      setShareError(getShareManagementErrorMessage(caughtError, t));
    } finally {
      setIsManagingShare(false);
    }
  };

  /** 읽기 ↔ 작성 for everyone: before the link exists it is only remembered; afterwards it is saved at once. */
  const changePublicPermission = async (permission: PublicSharePermission) => {
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
      setShareError(getShareManagementErrorMessage(caughtError, t));
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

  /** Friends picked in 친구 선택 join the batch with 보기만 (or the link's fixed role); each can be switched on its own. */
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
   * While 모든 사용자 is on, the role sent is always the link's - never whatever a row showed. Sent
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

  /** The "⋯" menu of one row: switch to the other permission (not while 모든 사용자 fixes it), then remove / cancel. */
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

  const inviteDisabled = !isOwnerView || isSending;

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
            {/* A. 모든 사용자: the public link with its permission. */}
            <SectionCard icon={<GlobeIcon color={colors.brand} size={18} />} testID="share-all-users" title={t('shareSheet.allUsersTitle')}>
              <Segmented
                disabled={isManagingShare}
                kind="radio"
                onChange={changePublicPermission}
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
                      <Text numberOfLines={1} style={styles.primaryLabel}>{t('shareSheet.shareLink')}</Text>
                    </Pressable>
                    <Pressable
                      accessibilityRole="button"
                      disabled={isManagingShare}
                      onPress={() => setIsUnshareConfirmVisible(true)}
                      style={[styles.secondaryButton, styles.flexButton]}
                      testID="share-stop"
                    >
                      <Text numberOfLines={1} style={styles.removeLabel}>{t('shareSheet.stopSharing')}</Text>
                    </Pressable>
                  </View>
                </>
              ) : (
                <>
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
                    accessibilityState={{ disabled: isManagingShare || isPublicBlocked, busy: isManagingShare }}
                    disabled={isManagingShare || isPublicBlocked}
                    onPress={startPublicShare}
                    style={[styles.primaryButton, (isManagingShare || isPublicBlocked) && styles.disabled]}
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
            </SectionCard>

            {/* B. 초대하기: [친구] | [ID] feeding one batch of people, each with their own 읽기/작성. */}
            <SectionCard icon={<PeopleIcon color={colors.brand} size={18} />} testID="share-invite" title={t('shareSheet.inviteTitle')}>
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
              {lockedRole ? <FixedRoleBadge role={lockedRole} testID="share-invite-fixed-role" /> : null}
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
                      {idLookup.status === 'lookingUp' ? <ActivityIndicator size="small" /> : <Text style={styles.secondaryLabel}>{t('collaboration.find')}</Text>}
                    </Pressable>
                  </View>
                  {idLookup.status === 'found' && idLookup.person ? (
                    // One row: who - their permission - "+" at the row's end.
                    <View style={styles.personRow} testID="id-invite-person">
                      <View style={styles.personRowText}>{personText(idLookup.person)}</View>
                      {lockedRole ? null : (
                        <RoleToggle
                          label={personLabel(idLookup.person)}
                          onChange={role => {
                            setActionError(null);
                            setIdRole(role);
                          }}
                          testID="id-invite-role"
                          value={idRole}
                        />
                      )}
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
                  ) : null}
                  {idLookup.message ? <Text style={styles.error} testID="id-invite-error">{idLookup.message}</Text> : null}
                </View>
              )}

              {drafts.length > 0 ? (
                <View style={styles.batch} testID="share-invite-list">
                  <View style={styles.batchHeader}>
                    <Text style={styles.batchTitle}>{t('shareSheet.inviteListTitle')}</Text>
                    <Text style={styles.cardCount} testID="share-invite-list-count">{t('shareSheet.selectedCount', { count: drafts.length })}</Text>
                  </View>
                  {drafts.map((draft, index) => (
                    <View key={draft.jupleId} style={[styles.listRow, index > 0 && styles.listRowDivider]} testID={`draft-${draft.jupleId}`}>
                      <View style={styles.listRowMain}>
                        {personText(draft)}
                        {lockedRole ? null : (
                          <RoleToggle
                            disabled={draft.status === 'sending'}
                            label={personLabel(draft)}
                            onChange={role => setDraftRole(draft.jupleId, role)}
                            testID={`draft-role-${draft.jupleId}`}
                            value={draft.role}
                          />
                        )}
                        <Pressable
                          accessibilityLabel={t('common.delete')}
                          accessibilityRole="button"
                          disabled={draft.status === 'sending'}
                          hitSlop={8}
                          onPress={() => removeDraft(draft.jupleId)}
                          style={styles.iconButton}
                          testID={`draft-remove-${draft.jupleId}`}
                        >
                          <Text style={styles.rowRemoveLabel}>×</Text>
                        </Pressable>
                      </View>
                      {draft.message ? <Text style={styles.error} testID={`draft-error-${draft.jupleId}`}>{draft.message}</Text> : null}
                    </View>
                  ))}
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
            </SectionCard>
            {actionError ? <Text style={styles.error} testID="share-action-error">{actionError}</Text> : null}

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
  content: { alignSelf: 'center', maxWidth: 640, padding: spacing.lg, width: '100%' },
  card: { backgroundColor: colors.surface, borderRadius: radii.lg, gap: spacing.sm, marginBottom: spacing.md, padding: spacing.lg },
  cardHeader: { alignItems: 'center', flexDirection: 'row', gap: spacing.sm },
  cardIcon: { alignItems: 'center', backgroundColor: colors.surfaceMuted, borderRadius: 14, height: 28, justifyContent: 'center', width: 28 },
  cardTitle: { color: colors.textPrimary, flex: 1, flexShrink: 1, fontSize: 16, fontWeight: '700' },
  cardCount: { color: colors.textSecondary, fontSize: 14, fontWeight: '600' },
  badge: { borderRadius: radii.md, flexShrink: 0, paddingHorizontal: spacing.sm, paddingVertical: 3 },
  segmented: {
    backgroundColor: colors.surfaceMuted,
    borderRadius: radii.md + 2,
    flexDirection: 'row',
    gap: 2,
    padding: 2,
  },
  segment: {
    alignItems: 'center',
    borderRadius: radii.md,
    flex: 1,
    justifyContent: 'center',
    minHeight: minTouchTarget - 4,
    minWidth: 0,
    paddingHorizontal: spacing.sm,
  },
  segmentSelected: { backgroundColor: colors.surface, borderColor: colors.brand, borderWidth: 1 },
  segmentLabel: { color: colors.textSecondary, fontSize: 14, fontWeight: '600' },
  segmentLabelSelected: { color: colors.brand, fontWeight: '700' },
  idArea: { gap: spacing.sm },
  batch: { borderTopColor: colors.divider, borderTopWidth: 1, gap: spacing.xs, marginTop: spacing.xs, paddingTop: spacing.sm },
  batchHeader: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
  batchTitle: { color: colors.textPrimary, fontSize: 14, fontWeight: '700' },
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
  fixedRole: { backgroundColor: colors.surfaceMuted, borderRadius: radii.md, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  fixedRoleLabel: { color: colors.textPrimary, fontSize: 13, fontWeight: '600' },
  inlineAction: { alignSelf: 'flex-start', justifyContent: 'center', minHeight: minTouchTarget },
  inlineActionLabel: { color: colors.brand, fontSize: 14, fontWeight: '700' },
  listRow: { gap: spacing.xs, paddingVertical: spacing.sm },
  listRowMain: { alignItems: 'center', flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  listRowDivider: { borderTopColor: colors.divider, borderTopWidth: 1 },
  personText: { flex: 1, minWidth: 120 },
  personName: { color: colors.textPrimary, fontSize: 15, fontWeight: '700' },
  jupleId: { color: colors.textSecondary, fontSize: 13, fontWeight: '600', letterSpacing: 1 },
  pendingStatus: { color: colors.textSecondary, fontSize: 13 },
  iconButton: { alignItems: 'center', justifyContent: 'center', minHeight: minTouchTarget, minWidth: minTouchTarget },
  rowRemoveLabel: { color: colors.textSecondary, fontSize: 20 },
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
    flexShrink: 1,
    gap: 2,
    padding: 2,
  },
  roleOption: {
    alignItems: 'center',
    borderRadius: radii.md,
    flexShrink: 1,
    justifyContent: 'center',
    minHeight: minTouchTarget,
    minWidth: 0,
    paddingHorizontal: spacing.sm,
  },
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
  removeLabel: { color: colors.danger, fontSize: 14, fontWeight: '600' },
  disabled: { opacity: 0.45 },
  loading: { paddingVertical: spacing.lg },
  error: { color: colors.danger, fontSize: 14 },
});
