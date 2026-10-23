'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiHttpError } from '../../../lib/appApi';
import { formatMessage } from '../../../lib/appI18n';
import { isSessionLost } from '../../../lib/authSession';
import { answerJoinRequest, answerLinkSubmission, loadJoinRequests, loadLinkSubmissions, type JoinRequest, type LinkSubmission } from '../../../lib/collectionApprovals';
import { contentGateOf } from '../../../lib/collectionDetails';
import { participantName } from '../../../lib/collectionSharing';
import { formatLinkTimestamp, isSafeHttpUrl, siteOf } from '../../../lib/savedLinks';
import { Avatar } from '../Avatar';
import { ConfirmDialog } from '../ConfirmDialog';
import { Glyph } from '../Glyph';
import { LinkImage } from '../LinkImage';
import { LoadFailed } from '../PageStates';
import { Modal } from '../Modal';
import { useSignedInApp } from '../AppRoot';
import { useAttention } from '../useAttention';
import styles from './ReceivedRequests.module.css';

type Loaded =
  | { readonly kind: 'loading' }
  | { readonly kind: 'failed'; readonly message: string | null }
  | { readonly kind: 'ready'; readonly links: readonly LinkSubmission[]; readonly people: readonly JoinRequest[] };

/**
 * The Owner's 받은 승인 요청 for ONE Collection: the links proposed to it (what, who, when) to approve or reject, and the people waiting to
 * join (approved as Viewers, or declined) - the same server calls and rules as mobile. Each answer is one request; a row that was already
 * answered elsewhere (404/409) just leaves the list; the badges are re-read from the same account store after every answer.
 */
export function ReceivedRequestsDialog({
  collection,
  open,
  onClose,
  onChanged,
}: {
  readonly collection: { readonly id: number; readonly name: string };
  readonly open: boolean;
  readonly onClose: () => void;
  /** Something was answered (the caller refreshes what it shows: its counts, its links). */
  readonly onChanged: () => void;
}) {
  const { dictionary } = useSignedInApp();
  const busyRef = useRef(false);
  // The Modal renders its body only while open, so every opening starts from a fresh load.
  return (
    <Modal closeLabel={dictionary.close} onClose={() => { if (!busyRef.current) onClose(); }} open={open} title={`${dictionary.requestsPendingSubmissions} · ${collection.name}`}>
      <RequestsBody collectionId={collection.id} onBusyChange={value => { busyRef.current = value; }} onChanged={onChanged} />
    </Modal>
  );
}

function RequestsBody({ collectionId, onBusyChange, onChanged }: { readonly collectionId: number; readonly onBusyChange: (busy: boolean) => void; readonly onChanged: () => void }) {
  const collection = { id: collectionId };
  const { api, dictionary, locale, onSessionLost } = useSignedInApp();
  const { store } = useAttention();
  const [state, setState] = useState<Loaded>({ kind: 'loading' });
  const [reload, setReload] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmReject, setConfirmReject] = useState<{ readonly kind: 'link' | 'person'; readonly id: number } | null>(null);
  const inFlight = useRef(false);

  useEffect(() => {
    let ignore = false;
    const people = loadJoinRequests(api, collection.id).catch(caught => (caught instanceof ApiHttpError && caught.status === 403 ? [] : Promise.reject(caught)));
    Promise.all([loadLinkSubmissions(api, collection.id), people]).then(
      ([links, joiners]) => {
        if (!ignore) setState({ kind: 'ready', links, people: joiners });
      },
      caught => {
        if (ignore) return;
        if (isSessionLost(caught)) {
          onSessionLost();
          return;
        }
        const gate = contentGateOf(caught);
        setState({ kind: 'failed', message: gate === 'sharePassword' ? dictionary.sharePasswordRequiredForAction : gate === 'lock' ? dictionary.lockRequiredForAction : null });
      },
    );
    return () => {
      ignore = true;
    };
  }, [api, collection.id, dictionary, onSessionLost, reload]);

  const afterAnswer = useCallback(() => {
    // Counts first from the account store (one metadata read), then whatever the caller shows.
    void store.read('collections', true).catch(() => undefined);
    onChanged();
  }, [onChanged, store]);

  const answer = async (kind: 'link' | 'person', id: number, approve: boolean) => {
    if (inFlight.current) return;
    inFlight.current = true;
    onBusyChange(true);
    setBusy(`${kind}-${id}`);
    setNotice(null);
    setError(null);
    try {
      const outcome = kind === 'link' ? await answerLinkSubmission(api, collection.id, id, approve) : await answerJoinRequest(api, collection.id, id, approve);
      setState(current =>
        current.kind !== 'ready'
          ? current
          : kind === 'link'
            ? { ...current, links: current.links.filter(row => row.submissionId !== id) }
            : { ...current, people: current.people.filter(row => row.requestId !== id) },
      );
      setNotice(
        outcome === 'gone'
          ? kind === 'link' ? dictionary.submissionsUnavailable : dictionary.joinRequestNotActionable
          : kind === 'link' ? (approve ? dictionary.submissionsApproved : dictionary.submissionsRejected) : null,
      );
      afterAnswer();
    } catch (caught) {
      if (isSessionLost(caught)) onSessionLost();
      else setError(caught instanceof ApiHttpError && caught.status === 429 ? dictionary.tooManyRequests : dictionary.submissionsActionError);
    } finally {
      inFlight.current = false;
      onBusyChange(false);
      setBusy(null);
    }
  };

  const links = state.kind === 'ready' ? state.links : [];
  const people = state.kind === 'ready' ? state.people : [];
  const rejecting = confirmReject;
  return (
    <>
      <div>
        <div aria-busy={state.kind === 'loading' || busy !== null} data-received-requests={collection.id}>
          {notice ? <p className={styles.notice} role="status">{notice}</p> : null}
          {error ? <p className={styles.error} role="alert">{error}</p> : null}
          {state.kind === 'loading' ? <p role="status">{dictionary.processing}</p> : null}
          {state.kind === 'failed' ? (
            state.message ? <p className={styles.error} role="alert">{state.message}</p> : <LoadFailed dictionary={dictionary} onRetry={() => { setState({ kind: 'loading' }); setReload(token => token + 1); }} />
          ) : null}
          {state.kind === 'ready' && links.length === 0 && people.length === 0 ? <p className={styles.empty}>{dictionary.submissionsEmpty}</p> : null}
          {links.length > 0 ? (
            <ul className={styles.list}>
              {links.map(link => {
                const title = link.title?.trim() || siteOf(link.url) || link.url;
                const person = link.proposer && link.proposer.kind !== 'publicLink' && link.proposer.jupleId ? { jupleId: link.proposer.jupleId, displayName: link.proposer.displayName } : null;
                const rowBusy = busy === `link-${link.submissionId}`;
                return (
                  <li className={styles.card} data-submission-id={link.submissionId} key={link.submissionId}>
                    <div className={styles.top}>
                      <span aria-hidden className={styles.thumb}>
                        <LinkImage fallback={<Glyph name="Link" size={22} />} src={isSafeHttpUrl(link.previewImageUrl) ? link.previewImageUrl : null} />
                      </span>
                      <div className={styles.text}>
                        <p className={styles.title} dir="auto">{title}</p>
                        <p className={styles.url}>{link.url}</p>
                        <div className={styles.meta}>
                          {person ? (
                            <span className={styles.who}>
                              <Avatar person={{ displayName: person.displayName, profileImageUrl: link.proposer?.profileImageUrl }} size={18} />
                              {participantName(person, dictionary)}
                            </span>
                          ) : (
                            <span>{dictionary.submissionsViaPublicLink}</span>
                          )}
                          <time dateTime={link.submittedAtUtc}>{formatLinkTimestamp(link.submittedAtUtc, locale, true)}</time>
                        </div>
                      </div>
                    </div>
                    <div className={styles.actions}>
                      <button aria-label={formatMessage(dictionary.submissionsRejectA11y, { title })} className={styles.reject} disabled={busy !== null} onClick={() => setConfirmReject({ kind: 'link', id: link.submissionId })} type="button">
                        {dictionary.submissionsReject}
                      </button>
                      <button aria-busy={rowBusy} aria-label={formatMessage(dictionary.submissionsApproveA11y, { title })} className={styles.approve} disabled={busy !== null} onClick={() => void answer('link', link.submissionId, true)} type="button">
                        {rowBusy ? dictionary.processing : dictionary.submissionsApprove}
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          ) : null}
          {people.length > 0 ? (
            <>
              <h3 className={styles.heading}>{dictionary.requestsJoinRequests}</h3>
              <ul className={styles.list}>
                {people.map(person => {
                  const name = participantName(person, dictionary);
                  const rowBusy = busy === `person-${person.requestId}`;
                  return (
                    <li className={styles.card} data-join-request-id={person.requestId} key={person.requestId}>
                      <div className={styles.top}>
                        <Avatar person={{ displayName: person.displayName, profileImageUrl: person.profileImageUrl }} size={44} />
                        <div className={styles.text}>
                          <p className={styles.title} dir="auto">{name}</p>
                          <div className={styles.meta}>
                            <time dateTime={person.requestedAtUtc}>{formatLinkTimestamp(person.requestedAtUtc, locale, true)}</time>
                          </div>
                        </div>
                      </div>
                      <div className={styles.actions}>
                        <button aria-label={formatMessage(dictionary.joinRequestRejectA11y, { name })} className={styles.reject} disabled={busy !== null} onClick={() => setConfirmReject({ kind: 'person', id: person.requestId })} type="button">
                          {dictionary.joinRequestReject}
                        </button>
                        <button aria-busy={rowBusy} aria-label={formatMessage(dictionary.joinRequestApproveA11y, { name })} className={styles.approve} disabled={busy !== null} onClick={() => void answer('person', person.requestId, true)} type="button">
                          {rowBusy ? dictionary.processing : dictionary.joinRequestApprove}
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </>
          ) : null}
        </div>
      </div>
      <ConfirmDialog
        cancelLabel={dictionary.cancel}
        confirmLabel={rejecting?.kind === 'person' ? dictionary.joinRequestReject : dictionary.submissionsReject}
        destructive
        message={rejecting?.kind === 'link' ? dictionary.submissionsRejectConfirmMessage : undefined}
        onCancel={() => setConfirmReject(null)}
        onConfirm={() => {
          const target = confirmReject;
          setConfirmReject(null);
          if (target) void answer(target.kind, target.id, false);
        }}
        open={rejecting !== null}
        title={rejecting?.kind === 'person' ? dictionary.joinRequestRejectTitle : dictionary.submissionsRejectConfirmTitle}
      />
    </>
  );
}
