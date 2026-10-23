'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { ApiHttpError } from '../../../lib/appApi';
import { isSessionLost } from '../../../lib/authSession';
import { receivedInvitations, respondToInvitation, type ReceivedCollectionInvitation } from '../../../lib/collectionInvitations';
import { participantName, roleLabel } from '../../../lib/collectionSharing';
import { formatBadgeCount } from '../../../lib/notifications';
import { useSignedInApp } from '../AppRoot';
import { LoadFailed } from '../PageStates';
import { Modal } from '../Modal';
import styles from '../app.module.css';

/** Kept outside the collection search: searching collections must not hide pending invitations. */
export function ReceivedInvitations({ onAccepted }: { readonly onAccepted: () => void }) {
  const { api, dictionary, onSessionLost, locale } = useSignedInApp();
  const notificationEntry = useSearchParams().get('invitations');
  const [items, setItems] = useState<readonly ReceivedCollectionInvitation[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [selected, setSelected] = useState<ReceivedCollectionInvitation | null>(null);
  const [busy, setBusy] = useState(false);
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
    Promise.resolve().then(() => { if (active) void load(); });
    const onFocus = () => { if (!inFlight.current) void load(); };
    const invalidate = () => { generation.current++; };
    window.addEventListener('focus', onFocus);
    return () => { active = false; invalidate(); window.removeEventListener('focus', onFocus); };
  }, [load, notificationEntry]);

  const respond = async (accept: boolean) => {
    if (!selected || inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setNotice(null);
    const invitation = selected;
    try {
      const result = await respondToInvitation(api, invitation.invitationId, accept);
      setItems(previous => previous.filter(item => item.invitationId !== invitation.invitationId));
      setSelected(null);
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
      setBusy(false);
    }
  };
  return (
    <section aria-busy={loading || busy} aria-label={dictionary.shareRequests}>
      <h2>{dictionary.shareRequests} <span aria-label={String(items.length)}>{formatBadgeCount(items.length)}</span></h2>
      {notice ? <p role="status">{notice}</p> : null}
      {failed ? <LoadFailed dictionary={dictionary} onRetry={() => void load()} /> : null}
      {loading ? <p role="status">{dictionary.processing}</p> : null}
      {!loading && !failed && items.length === 0 ? <p>{dictionary.invitationsEmpty}</p> : null}
      <ul className={styles.collectionList}>
        {items.map(item => (
          <li className={styles.collectionCard} key={item.invitationId}>
            <button className={styles.settingsAction} onClick={() => { setNotice(null); setSelected(item); }} type="button">
              {item.collectionName} · {participantName({ jupleId: item.ownerJupleId, displayName: item.ownerDisplayName }, dictionary)}
            </button>
          </li>
        ))}
      </ul>
      <Modal closeLabel={dictionary.close} onClose={() => { if (!inFlight.current) setSelected(null); }} open={selected !== null} title={dictionary.shareRequests}>
        {selected ? <>
          <h3>{selected.collectionName}</h3>
          <p>{dictionary.roleOwner}: {participantName({ jupleId: selected.ownerJupleId, displayName: selected.ownerDisplayName }, dictionary)}</p>
          <p>{roleLabel(selected.role, dictionary)}</p>
          <p>{new Date(selected.createdAtUtc).toLocaleString(locale)} — {new Date(selected.expiresAtUtc).toLocaleString(locale)}</p>
          {notice ? <p role="alert">{notice}</p> : null}
          <div className={styles.formActions}>
            <button className={styles.settingsAction} disabled={busy} onClick={() => void respond(false)} type="button">{dictionary.decline}</button>
            <button className={styles.primaryAction} disabled={busy} onClick={() => void respond(true)} type="button">{dictionary.accept}</button>
          </div>
        </> : null}
      </Modal>
    </section>
  );
}
