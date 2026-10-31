'use client';

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { formatJupleId } from '../../../../lib/accountDisplay';
import { formatMessage, type AppDictionary } from '../../../../lib/appI18n';
import { isSessionLost } from '../../../../lib/authSession';
import {
  avatarStackLayout,
  isSharedWithMe,
  participantName,
  roleLabel,
  shareDescription,
  type CollectionParticipant,
  type CollectionParticipants,
  type CollectionPendingInvitation,
  type CollectionShare,
  type PublicSharePermission,
} from '../../../../lib/collectionSharing';
import {
  PUBLIC_PERMISSIONS,
  countBelowMinimum,
  invitationRoleOf,
  isPermissionMismatch,
  isValidSharePassword,
  minimumRoleForPublicPermission,
  permissionBody,
  publicPermissionDescription,
  raiseToMinimum,
  roleOptionLabel,
  shareActionErrorMessage,
  shareManagementErrorMessage,
  sharePasswordBody,
  sharePasswordErrorMessage,
  sharePaths,
  SHARE_PASSWORD_MAX_LENGTH,
  SHARE_PASSWORD_MIN_LENGTH,
  type InvitationRole,
  type SharePasswordStatus,
} from '../../../../lib/collectionShareManage';
import type { CollectionDetail } from '../../../../lib/collectionDetails';
import { isCollectionLocked } from '../../../../lib/collectionsView';
import { unlockHeaders, unlockTokenFor } from '../../../../lib/collectionUnlock';
import {
  JUPLE_ID_LOOKUP_PATH,
  idInviteBody,
  idInviteUnavailable,
  idInviteUnavailableMessage,
  invitationsPath,
  inviteErrorMessage,
  selectableRoles,
  unavailableFriends,
  type IdInviteUnavailable,
} from '../../../../lib/collectionInvite';
import { lookupFailure, normalizeTypedJupleId, type JupleIdLookup } from '../../../../lib/settings';
import { useSignedInApp } from '../../AppRoot';
import { Avatar } from '../../Avatar';
import { ConfirmDialog } from '../../ConfirmDialog';
import { useSafety } from '../../SafetyProvider';
import { Glyph } from '../../Glyph';
import { PillListbox } from '../../Popover';
import { SettingsRowSkeleton } from '../../Skeletons';
import { UnlockPanel } from './UnlockPanel';
import { FriendPicker } from './FriendPicker';
import styles from '../../app.module.css';

/** Mobile ParticipantAvatarStack: placeholder circles until the list arrives, then up to 4 people (the last slot "+N"). */
export function ParticipantStack({
  participants,
  placeholderCount,
  onOpen,
  dictionary,
}: {
  readonly participants: readonly CollectionParticipant[] | null;
  readonly placeholderCount: number;
  readonly onOpen: () => void;
  readonly dictionary: AppDictionary;
}) {
  const count = participants?.length ?? placeholderCount;
  const { visible, hiddenCount } = avatarStackLayout(participants ?? [], 4);
  return (
    <button
      aria-label={formatMessage(dictionary.participantsAvatarsA11y, { count })}
      className={styles.avatarStack}
      onClick={onOpen}
      title={dictionary.participantsTitle}
      type="button"
    >
      {participants === null
        ? Array.from({ length: Math.max(1, Math.min(placeholderCount, 4)) }, (_, index) => <span aria-hidden className={`${styles.avatar} ${styles.skeleton}`} key={index} style={{ width: 28, height: 28 }} />)
        : visible.map(person => <Avatar key={person.jupleId} person={person} size={28} />)}
      {hiddenCount > 0 ? (
        <span aria-hidden className={`${styles.avatar} ${styles.avatarMore}`} style={{ width: 28, height: 28 }}>
          +{hiddenCount}
        </span>
      ) : null}
    </button>
  );
}


/** 사용자 차단 of one participant: asks first (SafetyProvider says what it does); memberships and links are untouched, so nothing here reloads. */
function BlockPersonButton({ person }: { readonly person: { readonly jupleId: string; readonly displayName?: string | null; readonly role: string; readonly isMe?: boolean } }) {
  const { dictionary } = useSignedInApp();
  const safety = useSafety();
  const name = participantName(person, dictionary);
  return (
    <button
      aria-label={`${dictionary.safetyBlockUserAction} ${name}`}
      className={styles.rowDanger}
      data-block-person
      onClick={() => safety.block({ jupleId: person.jupleId, name })}
      title={dictionary.safetyBlockUserAction}
      type="button"
    >
      <Glyph name="Block" size={18} />
    </button>
  );
}

/**
 * One person everywhere participants are drawn (header modal and share rail): the same Avatar (photo -> initial -> person glyph),
 * the name with "(나)", the Owner's crown on the avatar's corner, the Juple ID and the role.
 */
export function ParticipantIdentity({
  person,
  dictionary,
  caption,
  pending = false,
  trailing,
}: {
  readonly person: { readonly jupleId: string; readonly displayName?: string | null; readonly role: string; readonly isMe?: boolean; readonly profileImageUrl?: string | null };
  readonly dictionary: AppDictionary;
  /** Replaces the Juple ID line (a pending invitation says it is waiting). */
  readonly caption?: string;
  /** An invitation still waiting: the Juple ID stays, and "수락 대기" is a line of its own under it. */
  readonly pending?: boolean;
  readonly trailing?: ReactNode;
}) {
  const isOwner = person.role === 'owner';
  const role = roleLabel(person.role, dictionary);
  return (
    <>
      {/* The Owner is marked on the avatar's corner (Avatar draws the crown for role "owner"), never beside the name. */}
      <Avatar person={{ displayName: person.displayName, profileImageUrl: person.profileImageUrl, role: person.role }} size={40} />
      <span className={styles.personText}>
        <span className={styles.participantNameLine}>
          <span className={styles.settingsValueStart} dir="auto" title={participantName(person, dictionary)}>
            {participantName(person, dictionary)}
          </span>
        </span>
        <span className={styles.profileId} dir="ltr">
          {caption ?? `@${formatJupleId(person.jupleId)}`}
        </span>
        {pending ? <span className={styles.pendingCaption}>{dictionary.participantsPendingStatus}</span> : null}
      </span>
      {trailing ?? (role ? <span className={isOwner ? styles.roleBadgeOwner : styles.roleBadge}>{role}</span> : null)}
    </>
  );
}

/** The participant list (mobile CollectionParticipantsSheet's reading side): each person, their role, and invitations still waiting. */
export function ParticipantsPanel({
  data,
  failed,
  dictionary,
  embedded = false,
}: {
  readonly data: CollectionParticipants | null;
  readonly failed: boolean;
  readonly dictionary: AppDictionary;
  /** Inside a share card: no panel padding of its own. */
  readonly embedded?: boolean;
}) {
  if (failed && !data) {
    return <p className={styles.formError}>{dictionary.participantsLoadFallback}</p>;
  }
  if (!data) {
    return <SettingsRowSkeleton count={3} />;
  }
  return (
    <div className={embedded ? styles.panelBodyFlat : styles.panelBody}>
      <p className={styles.settingsHeading}>{formatMessage(dictionary.participantsMembersTab, { count: data.participants.length })}</p>
      <ul className={styles.personList}>
        {data.participants.map(person => (
          <li className={styles.personRow} key={person.jupleId}>
            <ParticipantIdentity dictionary={dictionary} person={person} trailing={person.isMe ? undefined : <BlockPersonButton person={person} />} />
          </li>
        ))}
      </ul>
      {data.pendingInvitations.length > 0 ? (
        <>
          <p className={styles.settingsHeading}>{formatMessage(dictionary.participantsPendingTab, { count: data.pendingInvitations.length })}</p>
          <ul className={styles.personList}>
            {data.pendingInvitations.map(invitation => (
              <li className={styles.personRow} key={invitation.invitationId}>
                <ParticipantIdentity caption={dictionary.participantsPendingStatus} dictionary={dictionary} person={invitation} />
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </div>
  );
}

type ShareState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'locked' }
  | { readonly kind: 'none' }
  | { readonly kind: 'ended' }
  | { readonly kind: 'failed' }
  | { readonly kind: 'owner'; readonly share: CollectionShare }
  | { readonly kind: 'member'; readonly url: string };

type Message = { readonly text: string; readonly error: boolean };

type Confirmation =
  | { readonly kind: 'raise'; readonly permission: PublicSharePermission }
  | { readonly kind: 'removeMember'; readonly person: CollectionParticipant }
  | { readonly kind: 'cancelInvitation'; readonly invitation: CollectionPendingInvitation }
  | { readonly kind: 'removePassword' };

/**
 * 공유 - the Collection's sharing as one workspace (mobile CollectionShareScreen): on the left the settings (공용 컬렉션 toggle and its
 * permission, the link, the access password, inviting friends), on the right the people - members with their role and what the
 * Owner can do about them, and the invitations still waiting. A member only sees the Owner's pass-on link and the people.
 */
export function SharePanel({
  collection,
  participants,
  participantsFailed,
  onParticipantsChanged,
  onMemberLinkGone,
  onUnlocked,
}: {
  readonly collection: CollectionDetail;
  readonly participants: CollectionParticipants | null;
  readonly participantsFailed: boolean;
  /** Invitations / roles / members changed: read the participants again. */
  readonly onParticipantsChanged: () => void;
  readonly onMemberLinkGone: () => void;
  /** The Owner unlocked the Collection here: its grant is this visit's now, so the page behind can open its content too. */
  readonly onUnlocked?: () => void;
}) {
  const { api, dictionary, onSessionLost } = useSignedInApp();
  const member = isSharedWithMe(collection);
  // The Owner's locked Collection needs its grant for everything the share screen reads or changes (mobile runUnlocked): without
  // one it asks for the lock password FIRST, then reads. Locked is its own state - never a loading one that waits for a request
  // nobody sends (the access-password skeleton used to stay forever: its request was skipped while the section was still drawn).
  const [ownerNeedsUnlock, setOwnerNeedsUnlock] = useState(() => !member && isCollectionLocked(collection) && unlockTokenFor(collection.id) === null);
  const [state, setState] = useState<ShareState>(() => (ownerNeedsUnlock ? { kind: 'locked' } : { kind: 'loading' }));
  const [message, setMessage] = useState<Message | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const [passwordStatus, setPasswordStatus] = useState<SharePasswordStatus | 'failed' | null>(null);
  const [passwordText, setPasswordText] = useState<string | null>(null);
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [revealed, setRevealed] = useState<string | null>(null);
  const [inviteMode, setInviteMode] = useState<'friends' | 'id'>('friends');
  // The row whose role is being changed, and the role asked for - shown at once, kept until the list is read again (or put back).
  const [roleChange, setRoleChange] = useState<{ readonly key: string; readonly role: InvitationRole; readonly source: CollectionParticipants | null } | null>(null);
  const canManage = participants?.canManage === true && !member;

  const failure = useCallback(
    (caught: unknown, words: (error: unknown) => string) => {
      if (isSessionLost(caught)) {
        onSessionLost();
        return;
      }
      setMessage({ text: words(caught), error: true });
    },
    [onSessionLost],
  );

  const readOwnerShare = useCallback(
    () =>
      api<{ readonly isShared: boolean; readonly share: CollectionShare | null }>({ path: sharePaths.share(collection.id), headers: unlockHeaders(collection.id) }).then<ShareState>(result =>
        result.share ? { kind: 'owner', share: result.share } : { kind: 'none' },
      ),
    [api, collection.id],
  );

  useEffect(() => {
    if (ownerNeedsUnlock) {
      return undefined;
    }
    let ignore = false;
    const request = member
      ? api<{ readonly isShared: boolean; readonly shareUrl: string | null }>({ path: `/api/v1/collections/${collection.id}/share/link` }).then<ShareState>(result =>
          result.isShared && result.shareUrl ? { kind: 'member', url: result.shareUrl } : { kind: 'ended' },
        )
      : readOwnerShare();
    request.then(
      next => {
        if (ignore) {
          return;
        }
        setState(next);
        if (next.kind === 'ended') {
          // The Owner turned the public link off meanwhile: sharing disappears here (mobile publicShareEnded).
          onMemberLinkGone();
        }
      },
      caught => {
        if (ignore) {
          return;
        }
        if (isSessionLost(caught)) {
          onSessionLost();
          return;
        }
        setState({ kind: 'failed' });
      },
    );
    return () => {
      ignore = true;
    };
    // Asked once per opening of the panel - and once more right after the Owner unlocked it here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ownerNeedsUnlock]);

  // The access password's state is the Owner's to see (it never carries the password itself).
  useEffect(() => {
    if (member || ownerNeedsUnlock) {
      return undefined;
    }
    let ignore = false;
    api<SharePasswordStatus>({ path: sharePaths.password(collection.id), headers: unlockHeaders(collection.id) }).then(
      status => {
        if (!ignore) {
          setPasswordStatus(status);
        }
      },
      caught => {
        if (ignore) {
          return;
        }
        if (isSessionLost(caught)) {
          onSessionLost();
          return;
        }
        setPasswordStatus('failed');
      },
    );
    return () => {
      ignore = true;
    };
    // Asked once per opening of the panel - and once more right after the Owner unlocked it here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ownerNeedsUnlock]);

  const share = state.kind === 'owner' ? state.share : null;
  const isPublic = share !== null && share.isPublic !== false;
  const currentPermission: PublicSharePermission = share?.permission ?? 'read';
  // While the Collection is public nobody is invited or kept below the link's own level (mobile minimumRole).
  const minimumRole = isPublic ? minimumRoleForPublicPermission(currentPermission) : null;
  const url = state.kind === 'owner' ? state.share.shareUrl : state.kind === 'member' ? state.url : null;
  const canSystemShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function';
  const legacy = passwordStatus !== null && passwordStatus !== 'failed' && passwordStatus.mode === 'legacyCommonLock';
  const passwordOn = passwordStatus !== null && passwordStatus !== 'failed' && passwordStatus.mode === 'perCollection' && passwordStatus.isEnabled;

  const run = async (action: () => Promise<void>, words: (error: unknown) => string) => {
    if (busy) {
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      await action();
    } catch (caught) {
      failure(caught, words);
    } finally {
      setBusy(false);
    }
  };

  const actionWords = (caught: unknown) => shareActionErrorMessage(caught, dictionary);

  const refreshShare = async () => {
    setState(await readOwnerShare());
  };

  const enableOrChange = (permission: PublicSharePermission, raise: boolean, fresh: boolean) =>
    run(
      async () => {
        await api<unknown>({
          method: fresh ? 'POST' : 'PUT',
          path: fresh ? sharePaths.share(collection.id) : sharePaths.permission(collection.id),
          body: permissionBody(permission, raise),
          headers: unlockHeaders(collection.id),
        });
        setConfirmation(null);
        await refreshShare();
        onParticipantsChanged();
      },
      caught => {
        if (isPermissionMismatch(caught) && !raise) {
          setConfirmation({ kind: 'raise', permission });
          return '';
        }
        setConfirmation(null);
        return shareManagementErrorMessage(caught, dictionary, permission);
      },
    );

  const choosePermission = (permission: PublicSharePermission, fresh: boolean) => {
    if (permission === currentPermission && !fresh) {
      return;
    }
    if (countBelowMinimum(participants, permission) > 0) {
      setConfirmation({ kind: 'raise', permission });
      return;
    }
    void enableOrChange(permission, false, fresh);
  };

  const togglePublic = () => {
    if (isPublic) {
      void run(
        async () => {
          await api<unknown>({ method: 'POST', path: sharePaths.makePrivate(collection.id), headers: unlockHeaders(collection.id) });
          await refreshShare();
          onParticipantsChanged();
        },
        caught => shareManagementErrorMessage(caught, dictionary, null),
      );
    } else {
      choosePermission(currentPermission, true);
    }
  };

  /**
   * A role change shows the chosen role at once (with the row busy); the list read again afterwards is the truth. A refusal puts the
   * role the server still has back and says why. Never below the public link's level (mobile changeRole).
   */
  const changeRole = (key: string, role: InvitationRole, path: string) => {
    if (raiseToMinimum(role, minimumRole) !== role) {
      setMessage({ text: dictionary.belowPublicPermission, error: true });
      return;
    }
    setRoleChange({ key, role, source: participants });
    void run(
      async () => {
        await api<unknown>({ method: 'PUT', path, body: { role }, headers: unlockHeaders(collection.id) });
        onParticipantsChanged();
      },
      caught => {
        setRoleChange(null);
        return actionWords(caught);
      },
    );
  };

  const changeMemberRole = (person: CollectionParticipant, role: InvitationRole) =>
    changeRole(`member-${person.jupleId}`, role, sharePaths.collaboratorRole(collection.id, person.jupleId));

  const changeInvitationRole = (invitation: CollectionPendingInvitation, role: InvitationRole) =>
    changeRole(`invitation-${invitation.invitationId}`, role, sharePaths.invitationRole(collection.id, invitation.invitationId));

  /** The role a row shows: the one just asked for while that change is on its way (until the list is read again), else the server's. */
  const shownRole = (key: string, serverRole: string): InvitationRole =>
    roleChange !== null && roleChange.key === key && roleChange.source === participants ? roleChange.role : invitationRoleOf(serverRole);

  const removeMember = (person: CollectionParticipant) =>
    run(async () => {
      await api<unknown>({ method: 'DELETE', path: sharePaths.collaborator(collection.id, person.jupleId), headers: unlockHeaders(collection.id) });
      setConfirmation(null);
      onParticipantsChanged();
    }, caught => {
      setConfirmation(null);
      return actionWords(caught);
    });

  const cancelInvitation = (invitation: CollectionPendingInvitation) =>
    run(async () => {
      await api<unknown>({ method: 'DELETE', path: sharePaths.invitation(collection.id, invitation.invitationId), headers: unlockHeaders(collection.id) });
      setConfirmation(null);
      onParticipantsChanged();
    }, caught => {
      setConfirmation(null);
      return actionWords(caught);
    });

  const savePassword = () => {
    if (passwordText === null || !isValidSharePassword(passwordText)) {
      return;
    }
    void run(
      async () => {
        const status = await api<SharePasswordStatus>({ method: 'PUT', path: sharePaths.password(collection.id), body: sharePasswordBody(passwordText), headers: unlockHeaders(collection.id) });
        setPasswordStatus(status);
        setPasswordText(null);
        setPasswordVisible(false);
        setRevealed(null);
      },
      caught => sharePasswordErrorMessage(caught, dictionary),
    );
  };

  const removePassword = () =>
    run(
      async () => {
        const status = await api<SharePasswordStatus>({ method: 'DELETE', path: sharePaths.password(collection.id), headers: unlockHeaders(collection.id) });
        setPasswordStatus(status);
        setConfirmation(null);
        setRevealed(null);
      },
      caught => {
        setConfirmation(null);
        return sharePasswordErrorMessage(caught, dictionary);
      },
    );

  const reveal = () =>
    run(
      async () => {
        const result = await api<{ readonly password: string }>({ method: 'POST', path: sharePaths.revealPassword(collection.id), headers: unlockHeaders(collection.id) });
        setRevealed(result.password);
      },
      caught => sharePasswordErrorMessage(caught, dictionary),
    );

  const systemShare = () => {
    if (!url) {
      return;
    }
    navigator.share({ title: collection.name, url }).catch((caught: unknown) => {
      // Dismissing the share sheet is not a failure.
      if (!(caught instanceof DOMException && caught.name === 'AbortError')) {
        setMessage({ text: dictionary.shareCopyFailed, error: true });
      }
    });
  };

  const copy = () => {
    if (!url) {
      return;
    }
    navigator.clipboard.writeText(url).then(
      () => setMessage({ text: dictionary.shareLinkCopied, error: false }),
      () => setMessage({ text: dictionary.shareCopyFailed, error: true }),
    );
  };

  const raiseCount = confirmation?.kind === 'raise' ? countBelowMinimum(participants, confirmation.permission) : 0;

  return (
    <div className={styles.shareWorkspace}>
      <div className={styles.shareSettings}>
        {state.kind === 'loading' ? <SettingsRowSkeleton count={3} /> : null}
        {state.kind === 'locked' ? (
          <UnlockPanel
            collectionId={collection.id}
            isOwner
            kind="lock"
            onStateChanged={() => {
              // The lock was removed meanwhile: nothing to unlock any more - read the share screen as it is.
              setState({ kind: 'loading' });
              setOwnerNeedsUnlock(false);
            }}
            onUnlocked={() => {
              setState({ kind: 'loading' });
              setOwnerNeedsUnlock(false);
              onUnlocked?.();
            }}
          />
        ) : null}
        {state.kind === 'ended' ? <p className={styles.stateMessage}>{dictionary.sharePublicEnded}</p> : null}
        {state.kind === 'failed' ? <p className={styles.formError}>{dictionary.shareCheckFailed}</p> : null}

        {canManage && (state.kind === 'owner' || state.kind === 'none') ? (
          <section className={styles.shareSection}>
            <div className={styles.shareSectionHead}>
              <span className={styles.shareSectionIcon} aria-hidden>
                <Glyph name="Link" size={20} />
              </span>
              <span className={styles.shareSectionText}>
                <h3 className={styles.shareSectionTitle}>{dictionary.sharePublicTitle}</h3>
                <p className={styles.shareSectionHint}>{share ? shareDescription(share, dictionary) : dictionary.sharePrivateDescription}</p>
              </span>
              <button aria-checked={isPublic} aria-label={dictionary.sharePublicTitle} className={isPublic ? styles.switchOn : styles.switchOff} disabled={busy} onClick={togglePublic} role="switch" type="button">
                <span aria-hidden className={styles.switchKnob} />
              </button>
            </div>
            {isPublic ? (
              <div aria-label={dictionary.sharePermissionLabel} className={styles.permissionChoices} role="radiogroup">
                {PUBLIC_PERMISSIONS.map(permission => (
                  <button
                    aria-checked={currentPermission === permission}
                    className={currentPermission === permission ? styles.permissionChoiceSelected : styles.permissionChoice}
                    data-permission={permission}
                    disabled={busy}
                    key={permission}
                    onClick={() => choosePermission(permission, false)}
                    role="radio"
                    type="button"
                  >
                    <span className={styles.permissionChoiceTitle}>{roleOptionLabel(permission === 'read' ? 'viewer' : permission === 'submit' ? 'submitter' : 'contributor', dictionary)}</span>
                    <span className={styles.permissionChoiceHint}>{publicPermissionDescription(permission, dictionary)}</span>
                  </button>
                ))}
              </div>
            ) : null}
          </section>
        ) : null}

        {url ? (
          <section className={styles.shareSection}>
            <div className={styles.shareSectionHead}>
              <span className={styles.shareSectionIcon} aria-hidden>
                <Glyph name="Share" size={20} />
              </span>
              <span className={styles.shareSectionText}>
                <h3 className={styles.shareSectionTitle}>{dictionary.shareLinkTitle}</h3>
              </span>
            </div>
            <p className={styles.sourceUrl} dir="ltr">
              {url}
            </p>
            <div className={styles.formActions}>
              {canManage && canSystemShare ? (
                <button className={styles.settingsAction} onClick={systemShare} type="button">
                  {dictionary.shareExternal}
                </button>
              ) : null}
              {!canManage ? <button className={styles.primaryAction} onClick={() => setPickerOpen(true)} type="button"><Glyph name="People" size={18} />{dictionary.chooseFriends}</button> : null}
              <button className={styles.primaryAction} onClick={copy} type="button">
                {dictionary.shareCopy}
              </button>
            </div>
          </section>
        ) : null}

        {canManage && !ownerNeedsUnlock ? (
          <section className={styles.shareSection}>
            <div className={styles.shareSectionHead}>
              <span className={styles.shareSectionIcon} aria-hidden>
                <Glyph name="Lock" size={20} />
              </span>
              <span className={styles.shareSectionText}>
                <h3 className={styles.shareSectionTitle}>{dictionary.sharePasswordTitle}</h3>
                <p className={styles.shareSectionHint}>{dictionary.sharePasswordDescription}</p>
              </span>
            </div>
            {passwordStatus === null ? <SettingsRowSkeleton count={1} /> : null}
            {passwordStatus === 'failed' ? <p className={styles.formError}>{dictionary.accessPasswordFallback}</p> : null}
            {passwordStatus !== null && passwordStatus !== 'failed' ? (
              <>
                {legacy ? <p className={styles.stateMessage}>{dictionary.accessPasswordLegacyNotice}</p> : null}
                <p className={styles.shareValue} data-password-state={passwordOn ? 'on' : 'off'}>
                  {passwordOn ? dictionary.collectionLockConfigured : dictionary.collectionLockNotConfigured}
                </p>
                {revealed !== null ? (
                  <p className={styles.revealedPassword} dir="ltr">
                    {revealed}
                  </p>
                ) : null}
                {passwordText !== null ? (
                  <form
                    className={styles.inlineForm}
                    noValidate
                    onSubmit={event => {
                      event.preventDefault();
                      savePassword();
                    }}
                  >
                    <label className={styles.fieldLabel} htmlFor="share-password-input">
                      {passwordOn ? dictionary.accessPasswordChangeLabel : dictionary.accessPasswordNewLabel}
                    </label>
                    <input
                      autoComplete="off"
                      className={styles.textInput}
                      dir="ltr"
                      id="share-password-input"
                      maxLength={SHARE_PASSWORD_MAX_LENGTH}
                      onChange={event => setPasswordText(event.target.value)}
                      type={passwordVisible ? 'text' : 'password'}
                      value={passwordText}
                    />
                    <p className={styles.settingsNote}>{formatMessage(dictionary.accessPasswordPolicy, { min: SHARE_PASSWORD_MIN_LENGTH, max: SHARE_PASSWORD_MAX_LENGTH })}</p>
                    <div className={styles.formActions}>
                      <button className={styles.settingsAction} onClick={() => setPasswordVisible(visible => !visible)} type="button">
                        {passwordVisible ? dictionary.passwordHide : dictionary.passwordShow}
                      </button>
                      <button className={styles.settingsAction} disabled={busy} onClick={() => { setPasswordText(null); setPasswordVisible(false); }} type="button">
                        {dictionary.cancel}
                      </button>
                      <button className={styles.primaryAction} disabled={busy || !isValidSharePassword(passwordText)} type="submit">
                        {dictionary.accessPasswordSubmit}
                      </button>
                    </div>
                  </form>
                ) : (
                  <div className={styles.formActions}>
                    <button className={styles.settingsAction} disabled={busy} onClick={() => setPasswordText('')} type="button">
                      {passwordOn ? dictionary.accessPasswordChange : dictionary.accessPasswordSetNew}
                    </button>
                    {passwordOn ? (
                      <>
                        <button className={styles.settingsAction} disabled={busy} onClick={() => (revealed === null ? void reveal() : setRevealed(null))} type="button">
                          {revealed === null ? dictionary.passwordShow : dictionary.passwordHide}
                        </button>
                        <button className={styles.dangerAction} disabled={busy} onClick={() => setConfirmation({ kind: 'removePassword' })} type="button">
                          {dictionary.accessPasswordRemove}
                        </button>
                      </>
                    ) : null}
                  </div>
                )}
              </>
            ) : null}
          </section>
        ) : null}

        {canManage && !ownerNeedsUnlock ? (
          <section className={styles.shareSection} data-invite>
            <div className={styles.shareSectionHead}>
              <span className={styles.shareSectionIcon} aria-hidden>
                <Glyph name="Plus" size={20} />
              </span>
              <span className={styles.shareSectionText}>
                <h3 className={styles.shareSectionTitle}>{dictionary.friendInviteTitle}</h3>
              </span>
            </div>
            {/* Mobile's two ways in one place: [친구] picks accepted friends, [ID] finds one exact Juple ID. Both send the same invitation. */}
            <div aria-label={dictionary.friendInviteTitle} className={styles.filterTabs} role="tablist">
              {(['friends', 'id'] as const).map(mode => (
                <button
                  aria-selected={inviteMode === mode}
                  className={inviteMode === mode ? styles.filterTabSelected : styles.filterTab}
                  data-invite-mode={mode}
                  key={mode}
                  onClick={() => setInviteMode(mode)}
                  role="tab"
                  type="button"
                >
                  {mode === 'friends' ? dictionary.inviteTabFriends : dictionary.inviteTabId}
                </button>
              ))}
            </div>
            {inviteMode === 'friends' ? (
              <button className={styles.primaryAction} disabled={legacy} onClick={() => setPickerOpen(true)} type="button">
                <Glyph name="People" size={18} />
                {dictionary.chooseFriends}
              </button>
            ) : (
              <IdInvite collectionId={collection.id} disabled={legacy} minimumRole={minimumRole} onInvited={onParticipantsChanged} participants={participants} />
            )}
          </section>
        ) : null}

        {message && message.text ? (
          <p className={message.error ? styles.fieldError : styles.formNotice} role={message.error ? 'alert' : 'status'}>
            {message.text}
          </p>
        ) : null}
      </div>

      <aside className={styles.shareRail}>
        <h3 className={styles.shareSectionTitle}>{dictionary.participantsTitle}</h3>
        {participantsFailed && !participants ? <p className={styles.formError}>{dictionary.participantsLoadFallback}</p> : null}
        {!participants && !participantsFailed ? <SettingsRowSkeleton count={3} /> : null}
        {participants ? (
          <div className={styles.shareRailScroll}>
            <p className={styles.settingsHeading}>{formatMessage(dictionary.participantsMembersTab, { count: participants.participants.length })}</p>
            <ul className={styles.personCards} data-members>
              {participants.participants.map(person => {
                const editable = canManage && person.role !== 'owner' && !person.isMe;
                const key = `member-${person.jupleId}`;
                return (
                  <li className={styles.personCard} data-person-row="member" key={person.jupleId}>
                    <ParticipantIdentity
                      dictionary={dictionary}
                      person={person}
                      trailing={
                        editable ? (
                          <span className={styles.personCardActions}>
                            <BlockPersonButton person={person} />
                            <RoleSelect
                              busy={busy}
                              changing={busy && roleChange?.key === key}
                              dictionary={dictionary}
                              minimumRole={minimumRole}
                              name={participantName(person, dictionary)}
                              onChange={role => changeMemberRole(person, role)}
                              value={shownRole(key, person.role)}
                            />
                            <button
                              aria-label={`${dictionary.removeMember} ${participantName(person, dictionary)}`}
                              className={styles.rowDanger}
                              data-destructive
                              disabled={busy}
                              onClick={() => setConfirmation({ kind: 'removeMember', person })}
                              title={dictionary.removeMember}
                              type="button"
                            >
                              <Glyph name="Trash" size={18} />
                            </button>
                          </span>
                        ) : person.isMe ? undefined : (
                          <span className={styles.personCardActions}>
                            <BlockPersonButton person={person} />
                          </span>
                        )
                      }
                    />
                  </li>
                );
              })}
            </ul>
            {participants.pendingInvitations.length > 0 ? (
              <>
                <p className={styles.settingsHeading}>{formatMessage(dictionary.participantsPendingTab, { count: participants.pendingInvitations.length })}</p>
                <ul className={styles.personCards} data-pending>
                  {participants.pendingInvitations.map(invitation => {
                    const key = `invitation-${invitation.invitationId}`;
                    return (
                      <li className={styles.personCard} data-person-row="pending" key={invitation.invitationId}>
                        <ParticipantIdentity
                          dictionary={dictionary}
                          pending
                          person={invitation}
                          trailing={
                            canManage ? (
                              <span className={styles.personCardActions}>
                                <RoleSelect
                                  busy={busy}
                                  changing={busy && roleChange?.key === key}
                                  dictionary={dictionary}
                                  minimumRole={minimumRole}
                                  name={participantName(invitation, dictionary)}
                                  onChange={role => changeInvitationRole(invitation, role)}
                                  value={shownRole(key, invitation.role)}
                                />
                                <button
                                  aria-label={`${dictionary.cancelInvitation} ${participantName(invitation, dictionary)}`}
                                  className={styles.rowDanger}
                                  data-destructive
                                  disabled={busy}
                                  onClick={() => setConfirmation({ kind: 'cancelInvitation', invitation })}
                                  title={dictionary.cancelInvitation}
                                  type="button"
                                >
                                  <Glyph name="Close" size={18} />
                                </button>
                              </span>
                            ) : (
                              <span className={styles.roleBadge}>{roleLabel(invitation.role, dictionary)}</span>
                            )
                          }
                        />
                      </li>
                    );
                  })}
                </ul>
              </>
            ) : null}
          </div>
        ) : null}
      </aside>

      <FriendPicker
        collectionId={collection.id}
        minimumRole={minimumRole}
        referral={!canManage}
        onClose={() => setPickerOpen(false)}
        onInvited={onParticipantsChanged}
        open={pickerOpen}
        unavailable={unavailableFriends(participants)}
      />

      <ConfirmDialog
        busy={busy}
        cancelLabel={dictionary.cancel}
        confirmLabel={dictionary.raiseRolesConfirm}
        message={formatMessage(dictionary.raiseRolesMessage, { count: raiseCount, permission: confirmation?.kind === 'raise' ? roleOptionLabel(confirmation.permission === 'read' ? 'viewer' : confirmation.permission === 'submit' ? 'submitter' : 'contributor', dictionary) : '' })}
        onCancel={() => setConfirmation(null)}
        onConfirm={() => {
          if (confirmation?.kind === 'raise') {
            void enableOrChange(confirmation.permission, true, !isPublic);
          }
        }}
        open={confirmation?.kind === 'raise'}
        title={dictionary.raiseRolesTitle}
      />
      <ConfirmDialog
        busy={busy}
        cancelLabel={dictionary.cancel}
        confirmLabel={dictionary.removeMember}
        destructive
        message={dictionary.removeMemberConfirmMessage}
        onCancel={() => setConfirmation(null)}
        onConfirm={() => {
          if (confirmation?.kind === 'removeMember') {
            void removeMember(confirmation.person);
          }
        }}
        open={confirmation?.kind === 'removeMember'}
        title={dictionary.removeMemberConfirmTitle}
      />
      <ConfirmDialog
        busy={busy}
        cancelLabel={dictionary.cancel}
        confirmLabel={dictionary.cancelInvitation}
        destructive
        onCancel={() => setConfirmation(null)}
        onConfirm={() => {
          if (confirmation?.kind === 'cancelInvitation') {
            void cancelInvitation(confirmation.invitation);
          }
        }}
        open={confirmation?.kind === 'cancelInvitation'}
        title={dictionary.cancelInvitation}
      />
      <ConfirmDialog
        busy={busy}
        cancelLabel={dictionary.cancel}
        confirmLabel={dictionary.accessPasswordRemove}
        destructive
        message={dictionary.accessPasswordRemoveMessage}
        onCancel={() => setConfirmation(null)}
        onConfirm={() => void removePassword()}
        open={confirmation?.kind === 'removePassword'}
        title={dictionary.accessPasswordRemoveTitle}
      />
    </div>
  );
}

/**
 * The one role selector of members AND invitations: its pill with a chevron opening a panel in the same look (PillListbox - a real
 * button + listbox, never the platform's own square menu). Only the real levels (읽기 전용 / 승인 후 추가 / 링크 추가), lowest first, none below the public link's
 * level; the Owner never has one (their row shows the 소유자 badge). One fixed width, so a longer label or the busy state never moves the
 * row. While a change is on its way the row is busy; a refusal puts the server's role back (SharePanel.changeRole).
 */
function RoleSelect({
  value,
  onChange,
  busy,
  changing,
  minimumRole,
  name,
  dictionary,
}: {
  readonly value: InvitationRole;
  readonly onChange: (role: InvitationRole) => void;
  readonly busy: boolean;
  readonly changing: boolean;
  readonly minimumRole: InvitationRole | null;
  readonly name: string;
  readonly dictionary: AppDictionary;
}) {
  // The current role always stays listed (an older one below the link's level is shown as it is, not silently changed).
  const roles = selectableRoles(minimumRole);
  const options = roles.includes(value) ? roles : [value, ...roles];
  return (
    <PillListbox
      busy={changing}
      disabled={busy}
      label={formatMessage(dictionary.permissionA11y, { name })}
      onChange={onChange}
      options={options.map(role => ({ value: role, label: roleOptionLabel(role, dictionary) }))}
      value={value}
    />
  );
}

type IdLookupState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'searching' }
  | { readonly kind: 'error'; readonly message: string }
  | { readonly kind: 'found'; readonly person: JupleIdLookup; readonly unavailable: IdInviteUnavailable | null };

/**
 * ID로 초대 (mobile CollectionShareScreen's ID tab): type one exact Juple ID, 찾기 looks it up (only then - never while typing), the
 * person shows with their photo, name and @ID, and - unless it is me, they are already in or already invited (each said plainly) -
 * a role and 초대 보내기. The same invitation as from the friend list (POST .../invitations { jupleId, role }), never below the public
 * link's level; once sent the person appears under 초대 대기 and the field is ready for the next ID.
 */
function IdInvite({
  collectionId,
  participants,
  minimumRole,
  disabled,
  onInvited,
}: {
  readonly collectionId: number;
  readonly participants: CollectionParticipants | null;
  readonly minimumRole: InvitationRole | null;
  readonly disabled: boolean;
  readonly onInvited: () => void;
}) {
  const { api, dictionary, onSessionLost } = useSignedInApp();
  const [typed, setTyped] = useState('');
  const [lookup, setLookup] = useState<IdLookupState>({ kind: 'idle' });
  const [chosenRole, setChosenRole] = useState<InvitationRole>('viewer');
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const role = raiseToMinimum(chosenRole, minimumRole);
  // A person found before the list changed (someone accepted, an invitation was sent elsewhere) is judged against the current list.
  const unavailable = lookup.kind === 'found' ? (idInviteUnavailable(lookup.person, participants) ?? lookup.unavailable) : null;

  const lost = (caught: unknown) => {
    if (isSessionLost(caught)) {
      onSessionLost();
      return true;
    }
    return false;
  };

  const find = (event: React.FormEvent) => {
    event.preventDefault();
    const jupleId = normalizeTypedJupleId(typed);
    if (!jupleId || lookup.kind === 'searching' || disabled) {
      return;
    }
    setLookup({ kind: 'searching' });
    setSendError(null);
    api<JupleIdLookup>({ method: 'POST', path: JUPLE_ID_LOOKUP_PATH, body: { jupleId } }).then(
      person => setLookup({ kind: 'found', person, unavailable: idInviteUnavailable(person, participants) }),
      caught => {
        if (!lost(caught)) {
          setLookup({ kind: 'error', message: lookupFailure(caught, dictionary) });
        }
      },
    );
  };

  const send = () => {
    if (lookup.kind !== 'found' || unavailable !== null || sending) {
      return;
    }
    setSending(true);
    setSendError(null);
    api<unknown>({ method: 'POST', path: invitationsPath(collectionId), body: idInviteBody(lookup.person.jupleId, role, minimumRole), headers: unlockHeaders(collectionId) }).then(
      () => {
        setSending(false);
        setTyped('');
        setChosenRole('viewer');
        setLookup({ kind: 'idle' });
        onInvited();
      },
      caught => {
        setSending(false);
        if (!lost(caught)) {
          setSendError(inviteErrorMessage(caught, dictionary));
        }
      },
    );
  };

  return (
    <div className={styles.idInvite} data-id-invite>
      <form className={styles.idInviteForm} onSubmit={find}>
        <input
          aria-label={dictionary.idInviteTitle}
          autoCapitalize="characters"
          autoComplete="off"
          className={styles.textInput}
          dir="ltr"
          disabled={disabled}
          onChange={event => {
            setTyped(event.target.value);
            if (lookup.kind !== 'idle' && lookup.kind !== 'searching') {
              setLookup({ kind: 'idle' });
            }
          }}
          placeholder={dictionary.inviteIdPlaceholder}
          spellCheck={false}
          value={typed}
        />
        <button className={styles.settingsAction} disabled={disabled || !normalizeTypedJupleId(typed) || lookup.kind === 'searching'} type="submit">
          {lookup.kind === 'searching' ? '…' : dictionary.inviteFind}
        </button>
      </form>
      {lookup.kind === 'error' ? (
        <p className={styles.fieldError} data-id-invite-state="error" role="alert">
          {lookup.message}
        </p>
      ) : null}
      {lookup.kind === 'found' ? (
        <div className={styles.idInviteResult} data-id-invite-state={unavailable ?? 'available'}>
          <div className={styles.idInvitePerson}>
            <Avatar person={{ displayName: lookup.person.displayName, profileImageUrl: lookup.person.profileImageUrl }} size={40} />
            <span className={styles.personText}>
              <span className={styles.settingsValueStart} dir="auto">
                {lookup.person.displayName?.trim() || formatJupleId(lookup.person.jupleId)}
              </span>
              <span className={styles.profileId} dir="ltr">
                @{formatJupleId(lookup.person.jupleId)}
              </span>
            </span>
          </div>
          {unavailable !== null ? (
            <p className={styles.stateMessage} role="status">
              {idInviteUnavailableMessage(unavailable, dictionary)}
            </p>
          ) : (
            <>
              <div aria-label={dictionary.sharePermissionLabel} className={styles.filterTabs} role="group">
                {selectableRoles(null).map(option => (
                  <button
                    aria-pressed={role === option}
                    className={role === option ? styles.filterTabSelected : styles.filterTab}
                    disabled={sending || raiseToMinimum(option, minimumRole) !== option}
                    key={option}
                    onClick={() => setChosenRole(option)}
                    type="button"
                  >
                    {roleOptionLabel(option, dictionary)}
                  </button>
                ))}
              </div>
              <button className={styles.primaryAction} disabled={sending} onClick={send} type="button">
                {sending ? dictionary.processing : dictionary.sendInvitations}
              </button>
            </>
          )}
          {sendError ? (
            <p className={styles.fieldError} role="alert">
              {sendError}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
