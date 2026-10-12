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
  INVITATION_ROLE_RANK,
  PUBLIC_PERMISSIONS,
  ROLES,
  countBelowMinimum,
  invitationRoleOf,
  isPermissionMismatch,
  isValidSharePassword,
  permissionBody,
  publicPermissionDescription,
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
import { unavailableFriends } from '../../../../lib/collectionInvite';
import { useSignedInApp } from '../../AppRoot';
import { Avatar } from '../../Avatar';
import { ConfirmDialog } from '../../ConfirmDialog';
import { Glyph } from '../../Glyph';
import { SettingsRowSkeleton } from '../../Skeletons';
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

/**
 * One person everywhere participants are drawn (header modal and share rail): the same Avatar (photo -> initial -> person glyph),
 * the name with "(나)", the Owner's crown, the Juple ID and the role.
 */
export function ParticipantIdentity({
  person,
  dictionary,
  caption,
  trailing,
}: {
  readonly person: { readonly jupleId: string; readonly displayName?: string | null; readonly role: string; readonly isMe?: boolean; readonly profileImageUrl?: string | null };
  readonly dictionary: AppDictionary;
  /** Replaces the Juple ID line (a pending invitation says it is waiting). */
  readonly caption?: string;
  readonly trailing?: ReactNode;
}) {
  const isOwner = person.role === 'owner';
  const role = roleLabel(person.role, dictionary);
  return (
    <>
      <Avatar person={{ displayName: person.displayName, profileImageUrl: person.profileImageUrl }} size={40} />
      <span className={styles.personText}>
        <span className={styles.participantNameLine}>
          {isOwner ? (
            <span aria-label={dictionary.roleOwner} className={styles.ownerCrown} role="img" title={dictionary.roleOwner}>
              <Glyph name="Crown" size={16} />
            </span>
          ) : null}
          <span className={styles.settingsValueStart} dir="auto" title={participantName(person, dictionary)}>
            {participantName(person, dictionary)}
          </span>
        </span>
        <span className={styles.profileId} dir="ltr">
          {caption ?? `@${formatJupleId(person.jupleId)}`}
        </span>
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
            <ParticipantIdentity dictionary={dictionary} person={person} />
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
}: {
  readonly collection: CollectionDetail;
  readonly participants: CollectionParticipants | null;
  readonly participantsFailed: boolean;
  /** Invitations / roles / members changed: read the participants again. */
  readonly onParticipantsChanged: () => void;
  readonly onMemberLinkGone: () => void;
}) {
  const { api, dictionary, onSessionLost } = useSignedInApp();
  const member = isSharedWithMe(collection);
  // The Owner's locked Collection needs its grant for the share state (mobile runUnlocked); without one, it says so.
  const ownerNeedsUnlock = !member && isCollectionLocked(collection) && unlockTokenFor(collection.id) === null;
  const [state, setState] = useState<ShareState>(() => (ownerNeedsUnlock ? { kind: 'locked' } : { kind: 'loading' }));
  const [message, setMessage] = useState<Message | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const [passwordStatus, setPasswordStatus] = useState<SharePasswordStatus | 'failed' | null>(null);
  const [passwordText, setPasswordText] = useState<string | null>(null);
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [revealed, setRevealed] = useState<string | null>(null);
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
    // Asked once per opening of the panel.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
    // Asked once per opening of the panel.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const share = state.kind === 'owner' ? state.share : null;
  const isPublic = share !== null && share.isPublic !== false;
  const currentPermission: PublicSharePermission = share?.permission ?? 'read';
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

  const changeMemberRole = (person: CollectionParticipant, role: InvitationRole) =>
    run(async () => {
      await api<unknown>({ method: 'PUT', path: sharePaths.collaboratorRole(collection.id, person.jupleId), body: { role }, headers: unlockHeaders(collection.id) });
      onParticipantsChanged();
    }, actionWords);

  const changeInvitationRole = (invitation: CollectionPendingInvitation, role: InvitationRole) =>
    run(async () => {
      await api<unknown>({ method: 'PUT', path: sharePaths.invitationRole(collection.id, invitation.invitationId), body: { role }, headers: unlockHeaders(collection.id) });
      onParticipantsChanged();
    }, actionWords);

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
        {state.kind === 'locked' ? <p className={styles.stateMessage}>{dictionary.collectionLockedWebMessage}</p> : null}
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
                <Glyph name="ExternalLink" size={20} />
              </span>
              <span className={styles.shareSectionText}>
                <h3 className={styles.shareSectionTitle}>{dictionary.shareLinkTitle}</h3>
              </span>
            </div>
            <p className={styles.sourceUrl} dir="ltr">
              {url}
            </p>
            <div className={styles.formActions}>
              {canSystemShare ? (
                <button className={styles.settingsAction} onClick={systemShare} type="button">
                  {dictionary.shareExternal}
                </button>
              ) : null}
              <button className={styles.primaryAction} onClick={copy} type="button">
                {dictionary.shareCopy}
              </button>
            </div>
          </section>
        ) : null}

        {canManage ? (
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

        {canManage ? (
          <section className={styles.shareSection}>
            <div className={styles.shareSectionHead}>
              <span className={styles.shareSectionIcon} aria-hidden>
                <Glyph name="Plus" size={20} />
              </span>
              <span className={styles.shareSectionText}>
                <h3 className={styles.shareSectionTitle}>{dictionary.friendInviteTitle}</h3>
              </span>
            </div>
            <button className={styles.primaryAction} disabled={legacy} onClick={() => setPickerOpen(true)} type="button">
              <Glyph name="People" size={18} />
              {dictionary.chooseFriends}
            </button>
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
          <>
            <p className={styles.settingsHeading}>{formatMessage(dictionary.participantsMembersTab, { count: participants.participants.length })}</p>
            <ul className={styles.personList}>
              {participants.participants.map(person => {
                const editable = canManage && person.role !== 'owner' && !person.isMe;
                return (
                  <li className={styles.personRow} key={person.jupleId}>
                    <ParticipantIdentity
                      dictionary={dictionary}
                      person={person}
                      trailing={
                        editable ? (
                          <span className={styles.rowActions}>
                            <RoleSelect busy={busy} dictionary={dictionary} onChange={role => void changeMemberRole(person, role)} value={invitationRoleOf(person.role)} />
                            <button aria-label={`${dictionary.removeMember} ${participantName(person, dictionary)}`} className={styles.iconButtonDanger} disabled={busy} onClick={() => setConfirmation({ kind: 'removeMember', person })} title={dictionary.removeMember} type="button">
                              <Glyph name="Close" size={18} />
                            </button>
                          </span>
                        ) : undefined
                      }
                    />
                  </li>
                );
              })}
            </ul>
            {participants.pendingInvitations.length > 0 ? (
              <>
                <p className={styles.settingsHeading}>{formatMessage(dictionary.participantsPendingTab, { count: participants.pendingInvitations.length })}</p>
                <ul className={styles.personList}>
                  {participants.pendingInvitations.map(invitation => (
                    <li className={styles.personRow} key={invitation.invitationId}>
                      <ParticipantIdentity
                        caption={dictionary.participantsPendingStatus}
                        dictionary={dictionary}
                        person={invitation}
                        trailing={
                          canManage ? (
                            <span className={styles.rowActions}>
                              <RoleSelect busy={busy} dictionary={dictionary} onChange={role => void changeInvitationRole(invitation, role)} value={invitationRoleOf(invitation.role)} />
                              <button aria-label={`${dictionary.cancelInvitation} ${participantName(invitation, dictionary)}`} className={styles.iconButtonDanger} disabled={busy} onClick={() => setConfirmation({ kind: 'cancelInvitation', invitation })} title={dictionary.cancelInvitation} type="button">
                                <Glyph name="Close" size={18} />
                              </button>
                            </span>
                          ) : undefined
                        }
                      />
                    </li>
                  ))}
                </ul>
              </>
            ) : null}
          </>
        ) : null}
      </aside>

      <FriendPicker
        collectionId={collection.id}
        minimumRole={isPublic ? (currentPermission === 'write' ? 'contributor' : currentPermission === 'submit' ? 'submitter' : null) : null}
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

/** A role (or invitation role) chooser: the three real levels, lowest first. */
function RoleSelect({ value, onChange, busy, dictionary }: { readonly value: InvitationRole; readonly onChange: (role: InvitationRole) => void; readonly busy: boolean; readonly dictionary: AppDictionary }) {
  return (
    <select
      aria-label={dictionary.sharePermissionLabel}
      className={styles.roleSelect}
      disabled={busy}
      onChange={event => onChange(event.target.value as InvitationRole)}
      value={value}
    >
      {[...ROLES].sort((a, b) => INVITATION_ROLE_RANK[a] - INVITATION_ROLE_RANK[b]).map(role => (
        <option key={role} value={role}>
          {roleOptionLabel(role, dictionary)}
        </option>
      ))}
    </select>
  );
}
