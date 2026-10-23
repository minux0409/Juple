'use client';
// Local browser regression only. No token source and no network API: every operation uses fixtures.
import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import FriendsPage from '../(app)/me/friends/page';
import { SignedInAppContext } from '../(app)/AppRoot';
import { CollectionsView } from '../(app)/collections/CollectionsView';
import { ToastProvider } from '../(app)/Toaster';
import { getAppDictionary } from '../../lib/appDictionary';
import { ApiHttpError, AuthExpiredError } from '../../lib/appApi';
import { COLLECTION_INVITATIONS_HREF } from '../../lib/collectionInvitations';
import { AppShell } from '../(app)/AppShell';
import { resolveAppDownload } from '../../lib/appDownload';

function createFixture(account: string) {
    const query = new URLSearchParams(typeof window === 'undefined' ? '' : window.location.search);
    const count = account === 'B' ? 0 : Number(query.get('fixtureCount') ?? 3);
    const friendCount = account === 'B' ? 0 : Number(query.get('fixtureFriends') ?? 0);
    const taskCount = account === 'B' ? 0 : Number(query.get('fixtureAttention') ?? 0);
    let newLinks = account === 'B' ? 0 : Number(query.get('fixtureNewLinks') ?? 0);
    let unread = Number(query.get('fixtureUnread') ?? 0);
    const failure = query.get('fixtureFailure');
    let failurePending = failure !== null;
    let pending = Array.from({ length: count }, (_, index) => index + 1);
    let accepted = false;
    const api = async ({ path, method = 'GET' }: { path: string; method?: string }) => {
      const calls = JSON.parse(sessionStorage.getItem('invitationCalls') ?? '[]');
      calls.push(`${method} ${path}`);
      sessionStorage.setItem('invitationCalls', JSON.stringify(calls));
      await new Promise(resolve => setTimeout(resolve, 100));
      if (path === '/api/v1/friends/requests') return { items: [
        ...Array.from({ length: friendCount }, (_, index) => ({ requestId: index + 1, direction: 'incoming', jupleId: 'FIXTURE', displayName: 'Fixture', createdAtUtc: '2026-10-23T00:00:00Z' })),
        { requestId: 500, direction: 'outgoing', jupleId: 'SENT', displayName: 'Sent', createdAtUtc: '2026-10-23T00:00:00Z' },
      ] };
      if (path === '/api/v1/notifications/unread-count') return { totalUnread: unread };
      if (path === '/api/v1/notifications/read-all') { unread = 0; newLinks = 0; return { markedCount: 1, unreadCount: 0 }; }
      if (path.startsWith('/api/v1/notifications?')) return { items: unread ? [{ id: 100, type: 'collectionInvitation', title: '초대 알림', body: 'Fixture', actor: null, collectionName: 'ddd', createdAtUtc: '2026-10-23T00:00:00Z', readAtUtc: null, target: { kind: 'collectionInvitations' } }] : [], nextCursor: null, unreadCount: unread };
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
        { id: 10, name: '잡동사니', icon: 'Folder', color: 'Blue', itemCount: 8, isFavorite: true, accessRole: 'owner', hasCollaborators: true, attentionCount: taskCount + newLinks, unreadNewLinkCount: newLinks },
        { id: 11, name: '웹툰', icon: 'Folder', color: 'Blue', itemCount: 5, isFavorite: true, accessRole: 'viewer', attentionCount: 0 },
      ], nextCursor: null };
      return { items: [], nextCursor: null };
    };
    return { api, dictionary: getAppDictionary('ko'), locale: 'ko', languagePreference: 'system', onSessionLost() { sessionStorage.setItem('sessionLost', 'true'); }, profile: null, account: { homeAccountId: account }, appDownload: resolveAppDownload({}), setLanguagePreference() {} };
}

export default function Page() {
  const query = useSearchParams();
  const [account, setAccount] = useState('A');
  const value = useMemo(() => createFixture(account), [account]);
  return <SignedInAppContext.Provider value={value as never}><ToastProvider><AppShell>
      <div><Link data-fixture-notification href={`/invitation-test-harness${COLLECTION_INVITATIONS_HREF.slice('/collections'.length)}`}>Invitation notification</Link>
      <button data-fixture-switch-account onClick={() => setAccount('B')} type="button">Switch fixture account</button></div>
      {query.get('fixturePage') === 'friends' ? <FriendsPage /> : <CollectionsView />}
  </AppShell></ToastProvider></SignedInAppContext.Provider>;
}
