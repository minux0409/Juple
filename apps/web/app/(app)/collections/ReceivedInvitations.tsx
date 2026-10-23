'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { ApiHttpError } from '../../../lib/appApi';
import { isSessionLost } from '../../../lib/authSession';
import { receivedInvitations, respondToInvitation, type ReceivedCollectionInvitation } from '../../../lib/collectionInvitations';
import { participantName, roleLabel } from '../../../lib/collectionSharing';
import { collectionTile } from '../../../lib/collectionsView';
import { Avatar } from '../Avatar';
import { CollectionGlyph, Glyph } from '../Glyph';
import { useSignedInApp } from '../AppRoot';
import { LoadFailed } from '../PageStates';
import { Modal } from '../Modal';
import styles from './ReceivedInvitations.module.css';

/** Kept outside the collection search: searching collections must not hide pending invitations. */
export function ReceivedInvitations({ onAccepted }: { readonly onAccepted: () => void }) {
  const { api, dictionary, onSessionLost } = useSignedInApp();
  const notificationEntry = useSearchParams().get('invitations');
  const [items, setItems] = useState<readonly ReceivedCollectionInvitation[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [open, setOpen] = useState(false);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const inFlight = useRef(false);
  const generation = useRef(0);
  const load = useCallback(async () => {
    const current = ++generation.current;
    setLoading(true);
    setFailed(false);
    try {
      const result = await receivedInvitations(api);
      if (current === generation.current) setItems(result);
    } catch (error) {
      if (current !== generation.current) return;
      if (isSessionLost(error)) onSessionLost();
      else setFailed(true);
    } finally {
      if (current === generation.current) setLoading(false);
    }
  }, [api, onSessionLost]);
  useEffect(() => {
    let active = true;
    Promise.resolve().then(() => {
      if (!active) return;
      if (notificationEntry) setOpen(true);
      void load();
    });
    const onFocus = () => { if (!inFlight.current) void load(); };
    const invalidate = () => { generation.current++; };
    window.addEventListener('focus', onFocus);
    return () => { active = false; invalidate(); window.removeEventListener('focus', onFocus); };
  }, [load, notificationEntry]);

  const respond = async (invitation: ReceivedCollectionInvitation, accept: boolean) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusyId(invitation.invitationId);
    setNotice(null);
    try {
      const result = await respondToInvitation(api, invitation.invitationId, accept);
      setItems(previous => previous.filter(item => item.invitationId !== invitation.invitationId));
      if (items.length === 1) setOpen(false);
      if (result === 'stale') setNotice(dictionary.invitationNoLongerValid);
      else if (accept) {
        setNotice(dictionary.invitationAccepted);
        onAccepted();
      }
      // Reload catches invitations handled by another device; a failure does not undo a successful response.
      void load();
    } catch (error) {
      if (isSessionLost(error)) onSessionLost();
      else setNotice(error instanceof ApiHttpError && error.status === 429 ? dictionary.tooManyRequests : dictionary.collaborationActionFallback);
    } finally {
      inFlight.current = false;
      setBusyId(null);
    }
  };
  return (
    <section aria-busy={loading || busyId !== null} aria-label={dictionary.shareRequests} className={styles.root}>
      {items.length > 0 ? <button aria-haspopup="dialog" aria-expanded={open} className={styles.entry} onClick={() => { setNotice(null); setOpen(true); }} type="button">
        <Glyph className={styles.people} name="People" size={20} />
        <span className={styles.entryLabel}>{dictionary.shareRequests}</span>
        <span className={styles.badge}>{items.length}</span>
        <Glyph className={styles.chevron} name="Chevron" size={16} />
      </button> : null}
      {!open && notice ? <p role="status">{notice}</p> : null}
      {!open && failed ? <LoadFailed dictionary={dictionary} onRetry={() => void load()} /> : null}
      {!open && loading && items.length === 0 ? <p role="status">{dictionary.processing}</p> : null}
      <Modal closeLabel={dictionary.close} onClose={() => { if (!inFlight.current) setOpen(false); }} open={open} title={dictionary.shareRequests}>
        {notice ? <p className={styles.notice} role="status">{notice}</p> : null}
        {failed ? <LoadFailed dictionary={dictionary} onRetry={() => void load()} /> : null}
        {loading && items.length === 0 ? <p role="status">{dictionary.processing}</p> : null}
        {!loading && !failed && items.length === 0 ? <p className={styles.empty}>{dictionary.invitationsEmpty}</p> : null}
        <ul className={styles.list}>
          {items.map(item => {
            const tile = collectionTile(item.color ?? null, item.collectionId);
            return <li className={styles.card} data-invitation-id={item.invitationId} key={item.invitationId}>
              <div className={styles.header}>
                <span aria-hidden className={styles.tile} style={{ background: tile.background, color: tile.icon }}><CollectionGlyph icon={item.icon ?? 'Folder'} size={20} /></span>
                <div className={styles.details}>
                  <h3 className={styles.name}>{item.collectionName}</h3>
                  <div className={styles.owner}>
                    <Avatar person={{ displayName: item.ownerDisplayName, profileImageUrl: item.ownerProfileImageUrl }} size={20} />
                    <span>{dictionary.roleOwner} {participantName({ jupleId: item.ownerJupleId, displayName: item.ownerDisplayName }, dictionary)}</span>
                  </div>
                  <p className={styles.meta}>{roleLabel(item.role, dictionary)}</p>
                </div>
              </div>
              <div className={styles.actions}>
                <button className={styles.decline} disabled={busyId !== null} onClick={() => void respond(item, false)} type="button">{dictionary.decline}</button>
                <button aria-busy={busyId === item.invitationId} className={styles.accept} disabled={busyId !== null} onClick={() => void respond(item, true)} type="button">{busyId === item.invitationId ? dictionary.processing : dictionary.accept}</button>
              </div>
            </li>;
          })}
        </ul>
      </Modal>
    </section>
  );
}
