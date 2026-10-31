'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { isSessionLost } from '../../../../lib/authSession';
import { ApiHttpError } from '../../../../lib/appApi';
import { COLLECTION_UNLOCK_HEADER } from '../../../../lib/collectionUnlock';
import { collectionHref } from '../../../../lib/savedLinks';
import {
  decideShareEntry,
  joinRequestPath,
  joinResultDestination,
  membershipPath,
  saveSharedCollectionPath,
  shareEntryTileKey,
  shareJoinErrorKey,
  type ShareJoinResult,
  type ShareMembership,
  type ShareProfile,
} from '../../../../lib/sharedCollectionEntry';
import { useSignedInApp } from '../../AppRoot';
import { Glyph } from '../../Glyph';
import { useSafety } from '../../SafetyProvider';
import { PendingJoinDialog } from '../../collections/PendingJoinDialog';
import { CollectionTileView } from '../../collections/CollectionsView';
import { readShareProfile, unlockShare } from './actions';
import styles from '../../app.module.css';

/**
 * A Juple Collection share link opened in the signed-in app (pasted on Home, typed, or caught by 새 링크 검토) - the mobile
 * SharedCollectionScreen, on the same API: a member goes straight to the Collection; anyone else sees ONE question with only the
 * Collection's own profile (tile and name - never an item, a URL or a member): 컬렉션 추가 [취소] [저장] for a public link, 참가 요청
 * [취소] [요청] for a private one, 승인 대기 중 while a request waits. Opening the link creates nothing; only 저장 / 요청 do. A protected
 * link asks for its password first (memory-only grant, bound to this link; it grants no membership by itself).
 */
export function SharedCollectionEntry({ publicId }: { readonly publicId: string }) {
  const { api, dictionary, onSessionLost } = useSignedInApp();
  const safety = useSafety();
  const router = useRouter();
  // undefined = still being read; null = no answer about me (unknown / revoked link, or a failed lookup - the link itself decides then).
  const [membership, setMembership] = useState<ShareMembership | null | undefined>(undefined);
  const [profile, setProfile] = useState<ShareProfile | 'unavailable' | undefined>(undefined);
  const [reloadToken, setReloadToken] = useState(0);
  // A protected link's grant after its password was verified: memory only (never stored, never in a URL).
  const [unlockToken, setUnlockToken] = useState<string | null>(null);
  const [password, setPassword] = useState('');
  const [visiblePassword, setVisiblePassword] = useState(false);
  const [unlockError, setUnlockError] = useState<'wrong' | 'throttled' | 'failed' | null>(null);
  const [isUnlocking, setIsUnlocking] = useState(false);
  const [isBusy, setIsBusy] = useState(false);
  const busyRef = useRef(false);
  const [message, setMessage] = useState<string | null>(null);

  // Who I am to this link - a member is sent to the normal Collection before anything else is shown.
  useEffect(() => {
    let ignore = false;
    api<ShareMembership>({ path: membershipPath(publicId) }).then(
      found => {
        if (!ignore) {
          setMembership(found);
        }
      },
      error => {
        if (ignore) {
          return;
        }
        if (isSessionLost(error)) {
          onSessionLost();
          return;
        }
        setMembership(null);
      },
    );
    return () => {
      ignore = true;
    };
  }, [api, onSessionLost, publicId, reloadToken]);

  // The link's own profile (through this app's server: the Public API is not open to this origin's browser).
  useEffect(() => {
    let ignore = false;
    readShareProfile(publicId, unlockToken).then(
      result => {
        if (!ignore) {
          setProfile(result.kind === 'found' ? result.profile : 'unavailable');
        }
      },
      () => {
        if (!ignore) {
          setProfile('unavailable');
        }
      },
    );
    return () => {
      ignore = true;
    };
  }, [publicId, unlockToken, reloadToken]);

  const isMember = membership?.isMember === true && typeof membership.collectionId === 'number';
  const entry = membership === undefined ? null : isMember ? decideShareEntry(membership, 'unavailable') : profile === undefined ? null : decideShareEntry(membership, profile);

  useEffect(() => {
    if (entry?.kind === 'member') {
      router.replace(collectionHref(entry.collectionId));
    }
  }, [entry, router]);

  /** 취소 / 확인: back where the link was opened from (or Home when it was the first page). */
  const leave = () => {
    if (window.history.length > 1) {
      router.back();
    } else {
      router.replace('/');
    }
  };

  const errorText = (error: unknown): string => {
    const key = shareJoinErrorKey(error);
    return {
      joinNotAllowed: dictionary.shareEntryJoinNotAllowed,
      joinLocked: dictionary.shareEntryJoinLocked,
      unavailable: dictionary.shareEntryUnavailableMessage,
      tooManyRequests: dictionary.tooManyRequests,
      joinFailed: dictionary.shareEntryJoinFailed,
    }[key];
  };

  /** 저장 or 요청 - one explicit action at a time, never repeated while one runs, never automatic. */
  const run = (path: string) => {
    if (busyRef.current) {
      return;
    }
    busyRef.current = true;
    setIsBusy(true);
    setMessage(null);
    api<ShareJoinResult>({ method: 'POST', path, headers: unlockToken ? { [COLLECTION_UNLOCK_HEADER]: unlockToken } : undefined })
      .then(
        result => {
          const destination = joinResultDestination(result);
          if (destination.kind === 'open') {
            // A member now: the normal Collection.
            router.replace(collectionHref(destination.collectionId));
            return;
          }
          setMembership(previous => ({ isMember: false, collectionId: null, role: null, ...previous, joinRequestPending: true }));
        },
        error => {
          if (isSessionLost(error)) {
            onSessionLost();
            return;
          }
          if (error instanceof ApiHttpError && error.status === 403) {
            // The grant ran out (or the link's password changed): back to the password, which asks again.
            setUnlockToken(null);
          }
          setMessage(errorText(error));
          // The Owner may have switched 공용 컬렉션 meanwhile: show the question that fits what the link is NOW.
          setReloadToken(token => token + 1);
        },
      )
      .finally(() => {
        busyRef.current = false;
        setIsBusy(false);
      });
  };

  const unlock = (event: React.FormEvent) => {
    event.preventDefault();
    if (!password || isUnlocking) {
      return;
    }
    setIsUnlocking(true);
    setUnlockError(null);
    unlockShare(publicId, password).then(
      result => {
        setIsUnlocking(false);
        if (result.kind === 'unlocked') {
          setPassword('');
          setUnlockToken(result.unlockToken);
          return;
        }
        if (result.kind === 'invalidPassword') {
          setPassword('');
          setUnlockError('wrong');
        } else if (result.kind === 'throttled') {
          setUnlockError('throttled');
        } else if (result.kind === 'notFound') {
          setProfile('unavailable');
        } else {
          setUnlockError('failed');
        }
      },
      () => {
        setIsUnlocking(false);
        setUnlockError('failed');
      },
    );
  };

  if (entry === null || entry.kind === 'member') {
    return (
      <section aria-busy className={styles.shareEntryPage}>
        <div aria-hidden className={styles.shareEntryCard}>
          <span className={`${styles.shareEntryTileSkeleton} ${styles.skeleton}`} />
          <span className={`${styles.skeletonLineShort} ${styles.skeleton}`} />
        </div>
      </section>
    );
  }

  if (entry.kind === 'unavailable') {
    return (
      <section className={styles.shareEntryPage}>
        <div className={styles.shareEntryCard} role="alert">
          <h1 className={styles.shareEntryTitle}>{dictionary.shareEntryUnavailableTitle}</h1>
          <p className={styles.shareEntryMessage}>{dictionary.shareEntryUnavailableMessage}</p>
          <div className={styles.shareEntryActions}>
            <button className={styles.primaryAction} onClick={leave} type="button">
              {dictionary.confirm}
            </button>
          </div>
        </div>
      </section>
    );
  }

  if (entry.kind === 'locked') {
    // Before its password nothing of the Collection is known or shown - not even its name.
    return (
      <section className={styles.shareEntryPage}>
        <form className={styles.shareEntryCard} noValidate onSubmit={unlock}>
          <h1 className={styles.shareEntryTitle}>{dictionary.shareEntryLockedTitle}</h1>
          <p className={styles.shareEntryMessage}>{dictionary.shareEntryLockedMessage}</p>
          <div className={styles.passwordRow}><input
            aria-invalid={unlockError === 'wrong' ? true : undefined}
            aria-label={dictionary.shareEntryPasswordLabel}
            autoComplete="off"
            className={styles.textInput}
            disabled={isUnlocking}
            onChange={event => {
              setPassword(event.target.value);
              setUnlockError(null);
            }}
            placeholder={dictionary.shareEntryPasswordLabel}
            type={visiblePassword ? 'text' : 'password'}
            value={password}
          /><button type="button" className={styles.passwordToggle} aria-label={visiblePassword ? dictionary.passwordHide : dictionary.passwordShow}
            aria-pressed={visiblePassword} onClick={() => setVisiblePassword(value => !value)}><Glyph name={visiblePassword ? 'Eye' : 'EyeOff'} size={20} /></button></div>
          {unlockError ? (
            <p className={styles.fieldError} role="alert">
              {unlockError === 'wrong' ? dictionary.shareEntryWrongPassword : unlockError === 'throttled' ? dictionary.shareEntryTooManyAttempts : dictionary.shareEntryUnlockFailed}
            </p>
          ) : null}
          <div className={styles.shareEntryActions}>
            <button className={styles.settingsAction} onClick={leave} type="button">
              {dictionary.cancel}
            </button>
            <button className={styles.primaryAction} disabled={isUnlocking || !password} type="submit">
              {dictionary.shareEntryUnlockAction}
            </button>
          </div>
        </form>
      </section>
    );
  }

  if (entry.kind === 'pending') return <PendingJoinDialog publicId={publicId} onClose={leave}
    onWithdrawn={() => router.replace('/collections?tab=shared')}><div className={styles.pendingJoinProfile}>
      <CollectionTileView collection={{ id: shareEntryTileKey(publicId), color: entry.profile.color ?? null, icon: entry.profile.icon ?? 'Folder', iconImageUrl: entry.profile.iconImageUrl ?? null }} size={72} />
      <strong dir="auto">{entry.profile.name}</strong>
    </div></PendingJoinDialog>;

  const { profile: shown } = entry;
  const tile = (
    <div className={styles.shareEntryTile}>
      <CollectionTileView
        collection={{ id: shareEntryTileKey(publicId), color: shown.color ?? null, icon: shown.icon ?? 'Folder', iconImageUrl: shown.iconImageUrl ?? null }}
        size={72}
      />
    </div>
  );
  const title = entry.kind === 'publicAdd' ? dictionary.shareEntryAddTitle : dictionary.shareEntryRequestTitle;
  const question = entry.kind === 'privateRequest' ? dictionary.shareEntryPrivateQuestion : null;

  return (
    <section className={styles.shareEntryPage}>
      <div aria-labelledby="share-entry-title" className={styles.shareEntryCard} role="group">
        <h1 className={styles.shareEntryTitle} id="share-entry-title">
          {title}
        </h1>
        {tile}
        <p className={styles.shareEntryName} dir="auto">
          {shown.name}
        </p>
        {question ? <p className={styles.shareEntryMessage}>{question}</p> : null}
        {message ? (
          <p className={styles.fieldError} role="alert">
            {message}
          </p>
        ) : null}
        {entry.kind === 'publicAdd' ? (
          <button className={styles.settingsAction} data-share-report disabled={isBusy} onClick={() => safety.report({ type: 'PublicShare', publicId })} type="button">
            {dictionary.safetyReportCollection}
          </button>
        ) : null}
        <div className={styles.shareEntryActions}>
            <>
              <button className={styles.settingsAction} disabled={isBusy} onClick={leave} type="button">
                {dictionary.cancel}
              </button>
              <button
                className={styles.primaryAction}
                disabled={isBusy}
                onClick={() => run(entry.kind === 'publicAdd' ? saveSharedCollectionPath(publicId) : joinRequestPath(publicId))}
                type="button"
              >
                {entry.kind === 'publicAdd' ? dictionary.save : dictionary.shareEntryRequestSend}
              </button>
            </>
        </div>
      </div>
    </section>
  );
}
