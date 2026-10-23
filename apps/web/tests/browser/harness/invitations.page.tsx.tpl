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
import { SavedLinkList } from '../(app)/SavedLinkList';
import { ReceivedRequestsDialog } from '../(app)/collections/ReceivedRequestsDialog';
import { collectionLinkView } from '../../lib/savedLinks';
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
    // A request + a notification that "arrive" while the page is open (fixtureLiveAfterMs after load): measures the real automatic refresh.
    const liveAfterMs = query.get('fixtureLiveAfterMs') === null ? null : Number(query.get('fixtureLiveAfterMs'));
    const startedAt = Date.now();
    const live = () => liveAfterMs !== null && Date.now() - startedAt >= liveAfterMs;
    if (liveAfterMs !== null) sessionStorage.setItem('liveAt', String(startedAt + liveAfterMs));
    // Reactions on the shared links (fixturePage=links): kept here so a tap really changes them for the next read.
    const reactionState: Record<number, { reactions: { key: string; count: number }[]; myReaction: string | null }> = {
      1: { reactions: [{ key: 'heart', count: 3 }, { key: 'laugh', count: 2 }, { key: 'thumbsUp', count: 1 }, { key: 'wow', count: 1 }, { key: 'sad', count: 1 }], myReaction: 'heart' },
      2: { reactions: [{ key: 'heart', count: 1 }], myReaction: null },
      3: { reactions: [], myReaction: null },
    };
    let pending = Array.from({ length: count }, (_, index) => index + 1);
    let accepted = false;
    // Owner's received requests (fixtureAttention = proposed links waiting in collection 10) and my own sent ones (fixtureMine).
    let proposals = Array.from({ length: taskCount }, (_, index) => index + 1);
    let mine = account === 'B' ? 0 : Number(query.get('fixtureMine') ?? 0);
    const api = async ({ path, method = 'GET', body }: { path: string; method?: string; body?: unknown }) => {
      const calls = JSON.parse(sessionStorage.getItem('invitationCalls') ?? '[]');
      calls.push(`${method} ${path}`);
      sessionStorage.setItem('invitationCalls', JSON.stringify(calls));
      await new Promise(resolve => setTimeout(resolve, 100));
      if (path === '/api/v1/collections/10/submissions') return { items: proposals.map(id => ({ submissionId: id, url: `https://example.com/p/${id}`, title: id === 1 ? '승인을 기다리는 아주 긴 링크 제목도 두 줄까지만 보이고 버튼을 가리지 않습니다' : `Proposal ${id}`, previewImageUrl: null, submittedAtUtc: '2026-10-23T00:00:00Z', viaPublicShare: false, proposer: { kind: 'member', jupleId: 'TEST-PROPOSER', displayName: 'Proposer', profileImageUrl: null } })), nextCursor: null };
      if (path === '/api/v1/collections/10/join-requests') return { items: [], nextCursor: null };
      if (path.startsWith('/api/v1/collections/10/submissions/')) {
        const id = Number(path.split('/')[6]);
        if (!proposals.includes(id)) throw new ApiHttpError(404, 'notFound');
        proposals = proposals.filter(value => value !== id);
        return undefined;
      }
      if (path === '/api/v1/collections/my-pending-submissions/count') return { myPendingSubmissionCount: mine };
      if (path === '/api/v1/collections/submissions/mine') return { items: Array.from({ length: mine }, (_, index) => ({ submissionId: 900 + index, url: `https://example.com/m/${index}`, title: `Mine ${index + 1}`, previewImageUrl: null, submittedAtUtc: '2026-10-23T00:00:00Z', collectionId: 11, collectionName: '웹툰' })), nextCursor: null, totalCount: mine };
      if (path.startsWith('/api/v1/collections/submissions/mine/') && method === 'DELETE') { mine = Math.max(0, mine - 1); return undefined; }
      if (path === '/api/v1/friends/requests') return { items: [
        ...Array.from({ length: friendCount }, (_, index) => ({ requestId: index + 1, direction: 'incoming', jupleId: 'FIXTURE', displayName: 'Fixture', createdAtUtc: '2026-10-23T00:00:00Z', profileImageUrl: index === 0 ? 'http://localhost:3198/icon.png' : null })),
        ...(live() && account !== 'B' ? [{ requestId: 600, direction: 'incoming', jupleId: 'LIVE', displayName: 'Live', createdAtUtc: '2026-10-23T00:00:00Z' }] : []),
        { requestId: 500, direction: 'outgoing', jupleId: 'SENT', displayName: 'Sent', createdAtUtc: '2026-10-23T00:00:00Z', profileImageUrl: 'http://localhost:3198/icon.png' },
      ] };
      if (path === '/api/v1/notifications/unread-count') return { totalUnread: unread + (live() ? 1 : 0) };
      if (/^\/api\/v1\/collections\/10\/items\/(\d+)\/reaction$/.test(path)) {
        const id = Number(path.split('/')[6]);
        const current = reactionState[id];
        if (method === 'DELETE') {
          if (current.myReaction) { const mineKey = current.myReaction; current.reactions = current.reactions.flatMap(r => r.key !== mineKey ? [r] : r.count > 1 ? [{ ...r, count: r.count - 1 }] : []); current.myReaction = null; }
        } else {
          const next = (body as { reactionKey: string }).reactionKey;
          if (current.myReaction) { const mineKey = current.myReaction; current.reactions = current.reactions.flatMap(r => r.key !== mineKey ? [r] : r.count > 1 ? [{ ...r, count: r.count - 1 }] : []); }
          const existing = current.reactions.find(r => r.key === next);
          current.reactions = existing ? current.reactions.map(r => r.key === next ? { ...r, count: r.count + 1 } : r) : [...current.reactions, { key: next, count: 1 }];
          current.myReaction = next;
        }
        return { reactions: current.reactions, myReaction: current.myReaction };
      }
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
        { id: 10, name: '잡동사니', icon: 'Folder', color: 'Blue', itemCount: 8, isFavorite: true, accessRole: 'owner', hasCollaborators: true, attentionCount: proposals.length + newLinks, unreadNewLinkCount: newLinks, pendingSubmissionCount: proposals.length, pendingJoinRequestCount: 0 },
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
      {query.get('fixturePage') === 'friends' ? <FriendsPage /> : query.get('fixturePage') === 'links' ? <LinksFixture /> : query.get('fixturePage') === 'requests' ? <ReceivedRequestsDialog collection={{ id: 10, name: '잡동사니' }} onChanged={() => undefined} onClose={() => undefined} open /> : <CollectionsView />}
  </AppShell></ToastProvider></SignedInAppContext.Provider>;
}

const ENTRIES = [
  { itemId: 1, url: 'https://www.youtube.com/watch?v=abc', title: '아주 긴 링크 제목도 두 줄까지만 보이고 카드의 줄 배치를 깨지 않아야 합니다 - 반응이 여러 개인 링크', memo: null, addedAtUtc: '2026-10-23T00:00:00Z', representativeImage: null, previewImageUrl: null, coverImage: null, isMine: false, addedBy: { kind: 'member', jupleId: 'TEST-ADDER', displayName: 'Adder', profileImageUrl: null }, reactions: [{ key: 'heart', count: 3 }, { key: 'laugh', count: 2 }, { key: 'thumbsUp', count: 1 }, { key: 'wow', count: 1 }, { key: 'sad', count: 1 }], myReaction: 'heart' },
  { itemId: 2, url: 'https://example.com/two', title: '반응 하나', memo: null, addedAtUtc: '2026-10-23T00:00:00Z', representativeImage: null, previewImageUrl: null, coverImage: null, isMine: false, addedBy: { kind: 'owner', jupleId: 'TEST-OWNER', displayName: 'Owner', profileImageUrl: null, isCollectionOwner: true }, reactions: [{ key: 'heart', count: 1 }], myReaction: null },
  { itemId: 3, url: 'https://example.com/three', title: '반응 없음', memo: null, addedAtUtc: '2026-10-23T00:00:00Z', representativeImage: null, previewImageUrl: null, coverImage: null, isMine: true, addedBy: { kind: 'me' }, reactions: [], myReaction: null },
];

function LinksFixture() {
  const query = useSearchParams();
  const mode = query.get('mode') === 'list' ? 'list' : 'grid';
  const value = useMemo(() => getAppDictionary('ko'), []);
  return <SavedLinkList dictionary={value} links={ENTRIES.map(entry => collectionLinkView(entry as never, 10, { showAdder: true }))} mode={mode} />;
}
