'use client';
// Local browser regression only. No token source and no network API: every operation uses fixtures.
import { useMemo } from 'react';
import Link from 'next/link';
import { SignedInAppContext } from '../(app)/AppRoot';
import { CollectionsView } from '../(app)/collections/CollectionsView';
import { ToastProvider } from '../(app)/Toaster';
import { getAppDictionary } from '../../lib/appDictionary';
import { ApiHttpError, AuthExpiredError } from '../../lib/appApi';
import { COLLECTION_INVITATIONS_HREF } from '../../lib/collectionInvitations';
import styles from '../(app)/app.module.css';

function createFixture() {
    const count = typeof window === 'undefined' ? 3 : Number(new URLSearchParams(window.location.search).get('fixtureCount') ?? 3);
    const failure = typeof window === 'undefined' ? null : new URLSearchParams(window.location.search).get('fixtureFailure');
    let failurePending = failure !== null;
    let pending = Array.from({ length: count }, (_, index) => index + 1);
    let accepted = false;
    const api = async ({ path, method = 'GET' }: { path: string; method?: string }) => {
      const calls = JSON.parse(sessionStorage.getItem('invitationCalls') ?? '[]');
      calls.push(`${method} ${path}`);
      sessionStorage.setItem('invitationCalls', JSON.stringify(calls));
      await new Promise(resolve => setTimeout(resolve, 100));
      if (path === '/api/v1/users/me/collection-invitations') return { items: pending.map(id => ({ invitationId: id, collectionId: id, collectionName: id === 1 ? 'ddd' : id === 2 ? '아주 긴 컬렉션 이름도 좁은 화면에서 버튼을 가리지 않고 여러 줄로 표시됩니다' : `Invite ${id}`, icon: 'Folder', color: 'Blue', ownerJupleId: 'TEST-OWNER', ownerDisplayName: 'PDA', role: 'Submitter', createdAtUtc: '2026-10-23T00:00:00Z', expiresAtUtc: '2026-10-30T00:00:00Z' })) };
      if (path.startsWith('/api/v1/collection-invitations/') && method === 'POST') {
        if (failurePending) {
          failurePending = false;
          if (failure === '401') throw new AuthExpiredError();
          throw new ApiHttpError(Number(failure), 'fixtureFailure');
        }
        const id = Number(path.split('/')[4]);
        pending = pending.filter(value => value !== id);
        if (id === 3) throw new ApiHttpError(409, 'invitationNotPending');
        if (path.endsWith('/accept')) accepted = true;
        return undefined;
      }
      if (path.startsWith('/api/v1/collections?')) return { items: [
        ...(accepted ? [{ id: 1, name: 'Accepted collection', icon: 'Folder', color: null, itemCount: 0, isFavorite: false, accessRole: 'viewer' }] : []),
        { id: 10, name: '잡동사니', icon: 'Folder', color: 'Blue', itemCount: 8, isFavorite: true, accessRole: 'viewer' },
        { id: 11, name: '웹툰', icon: 'Folder', color: 'Blue', itemCount: 5, isFavorite: true, accessRole: 'viewer' },
      ], nextCursor: null };
      return { items: [], nextCursor: null };
    };
    return { api, dictionary: getAppDictionary('ko'), locale: 'ko', languagePreference: 'system', onSessionLost() { sessionStorage.setItem('sessionLost', 'true'); }, profile: null, account: {}, appDownload: {}, setLanguagePreference() {} };
}

export default function Page() {
  const value = useMemo(createFixture, []);
  return <SignedInAppContext.Provider value={value as never}><ToastProvider><div className={styles.shell}>
    <main className={styles.content}><div className={styles.contentInner}>
      <Link href={`/invitation-test-harness${COLLECTION_INVITATIONS_HREF.slice('/collections'.length)}`}>Invitation notification</Link>
      <CollectionsView />
    </div></main>
  </div></ToastProvider></SignedInAppContext.Provider>;
}
