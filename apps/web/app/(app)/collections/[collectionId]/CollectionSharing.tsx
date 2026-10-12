'use client';

import { useEffect, useState } from 'react';
import { formatJupleId } from '../../../../lib/accountDisplay';
import { formatMessage, type AppDictionary } from '../../../../lib/appI18n';
import { isSessionLost } from '../../../../lib/authSession';
import {
  avatarStackLayout,
  isSharedWithMe,
  participantName,
  permissionLabel,
  roleLabel,
  shareDescription,
  type CollectionParticipant,
  type CollectionParticipants,
  type CollectionShare,
} from '../../../../lib/collectionSharing';
import type { CollectionDetail } from '../../../../lib/collectionDetails';
import { isCollectionLocked } from '../../../../lib/collectionsView';
import { unlockHeaders, unlockTokenFor } from '../../../../lib/collectionUnlock';
import { useSignedInApp } from '../../AppRoot';
import { Glyph } from '../../Glyph';
import { Avatar } from '../../Avatar';
import { SettingsRowSkeleton } from '../../Skeletons';
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

/** The participant list (mobile CollectionParticipantsSheet's reading side): each person, their role, and invitations still waiting. */
export function ParticipantsPanel({ data, failed, dictionary }: { readonly data: CollectionParticipants | null; readonly failed: boolean; readonly dictionary: AppDictionary }) {
  if (failed && !data) {
    return <p className={styles.formError}>{dictionary.participantsLoadFallback}</p>;
  }
  if (!data) {
    return <SettingsRowSkeleton count={3} />;
  }
  return (
    <div className={styles.panelBody}>
      <p className={styles.settingsHeading}>{formatMessage(dictionary.participantsMembersTab, { count: data.participants.length })}</p>
      <ul className={styles.personList}>
        {data.participants.map(person => (
          <li className={styles.personRow} key={person.jupleId}>
            <Avatar person={person} size={36} />
            <span className={styles.personText}>
              <span className={styles.settingsValueStart} dir="auto">
                {participantName(person, dictionary)}
              </span>
              <span className={styles.profileId} dir="ltr">
                @{formatJupleId(person.jupleId)}
              </span>
            </span>
            {roleLabel(person.role, dictionary) ? <span className={styles.roleBadge}>{roleLabel(person.role, dictionary)}</span> : null}
          </li>
        ))}
      </ul>
      {data.pendingInvitations.length > 0 ? (
        <>
          <p className={styles.settingsHeading}>{formatMessage(dictionary.participantsPendingTab, { count: data.pendingInvitations.length })}</p>
          <ul className={styles.personList}>
            {data.pendingInvitations.map(invitation => (
              <li className={styles.personRow} key={invitation.invitationId}>
                <Avatar person={invitation} size={36} />
                <span className={styles.personText}>
                  <span className={styles.settingsValueStart} dir="auto">
                    {participantName(invitation, dictionary)}
                  </span>
                  <span className={styles.profileId}>{dictionary.participantsPendingStatus}</span>
                </span>
                {roleLabel(invitation.role, dictionary) ? <span className={styles.roleBadge}>{roleLabel(invitation.role, dictionary)}</span> : null}
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

/**
 * 공유 - the Collection's link as the server has it right now: the Owner's own link with what it allows (public / private, its
 * permission, a share password), a member's pass-on of the Owner's still-public link. Shared with the browser's own share sheet where
 * there is one, else copied. Turning the link on / off and its settings stay in the app's 공유 screen for now.
 */
export function SharePanel({ collection, onMemberLinkGone }: { readonly collection: CollectionDetail; readonly onMemberLinkGone: () => void }) {
  const { api, dictionary, onSessionLost } = useSignedInApp();
  const member = isSharedWithMe(collection);
  // The Owner's locked Collection needs its grant for the share state (mobile runUnlocked); without one, it says so.
  const ownerNeedsUnlock = !member && isCollectionLocked(collection) && unlockTokenFor(collection.id) === null;
  const [state, setState] = useState<ShareState>(() => (ownerNeedsUnlock ? { kind: 'locked' } : { kind: 'loading' }));
  const [message, setMessage] = useState<{ readonly text: string; readonly error: boolean } | null>(null);

  useEffect(() => {
    if (ownerNeedsUnlock) {
      return undefined;
    }
    let ignore = false;
    const request = member
      ? api<{ readonly isShared: boolean; readonly shareUrl: string | null }>({ path: `/api/v1/collections/${collection.id}/share/link` }).then<ShareState>(result =>
          result.isShared && result.shareUrl ? { kind: 'member', url: result.shareUrl } : { kind: 'ended' },
        )
      : api<{ readonly isShared: boolean; readonly share: CollectionShare | null }>({ path: `/api/v1/collections/${collection.id}/share`, headers: unlockHeaders(collection.id) }).then<ShareState>(result =>
          result.share ? { kind: 'owner', share: result.share } : { kind: 'none' },
        );
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

  const url = state.kind === 'owner' ? state.share.shareUrl : state.kind === 'member' ? state.url : null;
  const canSystemShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function';

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

  return (
    <div className={styles.panelBody}>
      {state.kind === 'loading' ? <SettingsRowSkeleton count={2} /> : null}
      {state.kind === 'locked' ? <p className={styles.stateMessage}>{dictionary.collectionLockedWebMessage}</p> : null}
      {state.kind === 'none' ? <p className={styles.stateMessage}>{dictionary.shareLinkInAppOnly}</p> : null}
      {state.kind === 'ended' ? <p className={styles.stateMessage}>{dictionary.sharePublicEnded}</p> : null}
      {state.kind === 'failed' ? <p className={styles.formError}>{dictionary.shareCheckFailed}</p> : null}
      {state.kind === 'owner' ? (
        <div className={styles.settingsCard}>
          <div className={styles.settingsRow}>
            <span className={styles.settingsLabel}>{dictionary.sharePublicTitle}</span>
            {state.share.isPublic !== false ? <span className={styles.settingsValue}>{permissionLabel(state.share.permission, dictionary)}</span> : null}
          </div>
          <p className={styles.settingsNote}>{shareDescription(state.share, dictionary)}</p>
          {collection.isSharePasswordProtected ? (
            <div className={styles.settingsRow}>
              <span className={styles.settingsLabel}>{dictionary.sharePasswordTitle}</span>
              <Glyph name="Lock" size={16} />
            </div>
          ) : null}
        </div>
      ) : null}
      {url ? (
        <>
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
        </>
      ) : null}
      {message ? (
        <p className={message.error ? styles.fieldError : styles.formNotice} role={message.error ? 'alert' : 'status'}>
          {message.text}
        </p>
      ) : null}
    </div>
  );
}
