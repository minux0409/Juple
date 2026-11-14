'use client';
// Test-only (copied to app/polish-test-harness/ by tests/browser/polish.browser.mjs and deleted afterwards).
// The REAL screens (Home, 보관함, Collections, a Collection, the link details sheet, 링크 저장, the sign-in card) inside the real app shell, on a
// local stub API. Every write is recorded in sessionStorage ('writes') so a test can read the exact request that would have been sent.
import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { SignedInAppContext } from '../(app)/AppRoot';
import { ToastProvider } from '../(app)/Toaster';
import { SafetyProvider } from '../(app)/SafetyProvider';
import { HomeView } from '../(app)/HomeView';
import { ArchiveView } from '../(app)/archive/ArchiveView';
import { CollectionsView } from '../(app)/collections/CollectionsView';
import { CollectionDetailsView } from '../(app)/collections/[collectionId]/CollectionDetailsView';
import { NewLinkReviewView } from '../(app)/items/new/NewLinkReviewView';
import { QuickSheetFrame } from '../(app)/items/[itemId]/QuickDetailSheet';
import { ItemDetailContent } from '../(app)/items/[itemId]/ItemDetailContent';
import { Landing } from '../(app)/Landing';
import { ApiHttpError } from '../../lib/appApi';
import { subscribeItemsChanged } from '../../lib/itemChanges';
import { getAppDictionary } from '../../lib/appDictionary';
import { isAppLanguage, isRtlLanguage, type AppLanguage } from '../../lib/appI18n';
import { resolveAppDownload } from '../../lib/appDownload';
import { AppShell } from './AppShell';

const COLLECTIONS = [
  { id: 10, name: '웹툰', icon: 'Folder', color: 'Blue', itemCount: 12, isFavorite: true, accessRole: 'owner' },
  { id: 11, name: '여행 준비 - 일본 도쿄 3박 4일 맛집과 숙소 후보 모음', icon: 'Plane', color: 'Mint', itemCount: 31, isFavorite: true, accessRole: 'owner', hasCollaborators: true, otherParticipantCount: 2, participantPreview: [{ jupleId: 'A1', displayName: 'Mina', role: 'contributor' }, { jupleId: 'B2', displayName: 'Joon', role: 'viewer' }] },
  { id: 12, name: 'Design inspiration', icon: 'Heart', color: 'Rose', itemCount: 4, isFavorite: false, accessRole: 'owner' },
  { id: 13, name: 'Recipes', icon: 'Coffee', color: 'Amber', itemCount: 0, isFavorite: false, accessRole: 'owner' },
  { id: 14, name: '비밀 컬렉션', icon: 'Lock', color: 'Purple', itemCount: 3, isFavorite: false, accessRole: 'owner', isLocked: true },
  { id: 15, name: 'Shared by Mina', icon: 'Music', color: 'Teal', itemCount: 9, isFavorite: false, accessRole: 'contributor', hasCollaborators: true },
];

const TITLES = [
  ['https://www.youtube.com/watch?v=abc123', '작은 습관이 인생을 바꾸는 방법 - 하루 10분으로 시작하는 루틴 만들기 (긴 제목 줄바꿈 확인용 제목입니다)', '유튜브에서 보려고 저장'],
  ['https://www.instagram.com/reel/C1a2B3c4D5e/', '', null],
  ['https://velog.io/@juple/clean-architecture', 'Clean architecture in practice', '나중에 읽기'],
  ['https://www.musinsa.com/products/123456', '오버핏 후드 집업 - 무신사 스탠다드', null],
  ['https://example.com/a', 'A very long unbroken title: Supercalifragilisticexpialidocious_and_more_and_more_and_more', 'memo with a long sentence to make sure a wrapping memo stays inside the card and never overflows'],
  ['https://news.naver.com/article/1', '오늘의 뉴스 요약', null],
  ['https://www.coupang.com/vp/products/777', '쿠팡 로켓배송 상품', null],
  ['https://github.com/vercel/next.js', 'vercel/next.js: The React Framework', null],
] as const;

function entries() {
  return TITLES.map(([url, title, memo], index) => ({
    id: index + 1,
    url,
    title: title || null,
    memo,
    savedAtUtc: new Date(Date.now() - index * 3_600_000).toISOString(),
    representativeImage: null,
    previewImageUrl: null,
    coverImage: null,
  }));
}

function record(key: string, value: string) {
  const list = JSON.parse(sessionStorage.getItem(key) ?? '[]') as string[];
  list.push(value);
  sessionStorage.setItem(key, JSON.stringify(list));
}

function createApi() {
  return async (request: { path: string; method?: string; body?: unknown }) => {
    const method = request.method ?? 'GET';
    const path = request.path;
    const clean = path.split('?')[0];
    record('calls', `${method} ${path}`);
    if (method !== 'GET') {
      let body: unknown = request.body;
      if (typeof FormData !== 'undefined' && body instanceof FormData) {
        const file = body.get('file') as File | null;
        body = { form: { file: file ? { name: file.name, type: file.type, size: file.size } : null } };
      }
      record('writes', JSON.stringify({ method, path, body }));
    }
    await new Promise(resolve => setTimeout(resolve, 40));
    const flags = new URLSearchParams(window.location.search);
    const failOn = flags.get('failOn');
    if (failOn && method !== 'GET' && clean.endsWith('/' + failOn)) throw new ApiHttpError(500, null);
    if (flags.get('fail') === 'details' && method === 'PUT' && clean === '/api/v1/items/7/details') throw new ApiHttpError(500, null);
    if (method === 'POST' && clean === '/api/v1/items/7/images') return { id: 5, readUrl: 'https://blob.example.test/items/7/cover.png' };
    if (method === 'DELETE' && /^\/api\/v1\/items\/7\/images\/\d+$/.test(clean)) return undefined;
    if (clean === '/api/v1/items/history/count') return { count: 8 };
    if (clean === '/api/v1/items/history/sections') return { sections: [{ key: 'today', kind: 'today', year: null, month: null, fromUtc: new Date(Date.now() - 86_400_000).toISOString(), toUtc: null, count: 8 }] };
    if (clean === '/api/v1/items/history') return { items: entries(), nextCursor: null };
    if (clean === '/api/v1/home/summary') return {};
    if (clean === '/api/v1/recently-opened-links') return { items: [] };
    if (clean === '/api/v1/collections' && method === 'POST') {
      const body = request.body as { name: string; icon: string; color: string };
      return { id: 99, itemCount: 0, isFavorite: false, accessRole: 'owner', ...body };
    }
    if (clean === '/api/v1/collections') {
      if (path.includes('itemId=7')) return { items: new URLSearchParams(window.location.search).get('m') === '2' ? [COLLECTIONS[0], COLLECTIONS[5]] : [COLLECTIONS[0]], nextCursor: null };
      const scope = new URLSearchParams(path.split('?')[1] ?? '').get('scope');
      const list = scope === 'favorites' ? COLLECTIONS.filter(entry => entry.isFavorite) : scope === 'shared' ? COLLECTIONS.filter(entry => entry.accessRole !== 'owner' || entry.hasCollaborators) : COLLECTIONS;
      return { items: list, nextCursor: null };
    }
    if (/^\/api\/v1\/collections\/\d+$/.test(clean)) return COLLECTIONS.find(entry => `/api/v1/collections/${entry.id}` === clean) ?? COLLECTIONS[0];
    if (/^\/api\/v1\/collections\/\d+\/items\/sections$/.test(clean)) return { sections: [{ key: 'today', kind: 'today', year: null, month: null, fromUtc: new Date(Date.now() - 86_400_000).toISOString(), toUtc: null, count: 8 }] };
    if (/^\/api\/v1\/collections\/\d+\/items$/.test(clean)) {
      return {
        items: entries().map(entry => (entry.id >= 5
          ? { itemId: entry.id, url: entry.url, title: entry.title, memo: null, previewImageUrl: null, coverImage: null, addedAtUtc: entry.savedAtUtc, isMine: false, addedBy: { kind: 'member', jupleId: 'MINA', displayName: 'Mina' } }
          : { itemId: entry.id, url: entry.url, title: entry.title, memo: entry.memo, previewImageUrl: null, coverImage: null, addedAtUtc: entry.savedAtUtc, isMine: true, addedBy: { kind: 'me', jupleId: 'ME', displayName: 'Me' } })),
        nextCursor: null,
      };
    }
    if (/^\/api\/v1\/collections\/\d+\/participants$/.test(clean)) return { participants: [], pending: [] };
    if (clean === '/api/v1/items/7') return { id: 7, url: 'https://www.youtube.com/watch?v=abc123', title: '작은 습관이 인생을 바꾸는 방법', memo: '유튜브에서 보려고 저장', savedAtUtc: '2026-11-10T00:00:00Z', previewImageUrl: null, coverImage: null };
    if (clean === '/api/v1/items/7/images') return { images: [] };
    if (clean === '/api/v1/url-metadata/resolve') return { title: 'Resolved title from the page', previewImageUrl: null };
    if (clean.includes('unread')) return { unreadCount: 3 };
    return { items: [], nextCursor: null };
  };
}

export default function Page() {
  const query = useSearchParams();
  const language: AppLanguage = isAppLanguage(query.get('lang')) ? (query.get('lang') as AppLanguage) : 'ko';
  const scene = query.get('scene') ?? 'home';
  const dictionary = getAppDictionary(language);
  const [open, setOpen] = useState(true);
  // What the lists under the sheet would hear: recorded so a test can tell that a save / delete reached them.
  useEffect(() => subscribeItemsChanged(change => record('changes', JSON.stringify(change))), []);
  const value = useMemo(
    () => ({
      api: createApi(),
      dictionary,
      locale: language,
      languagePreference: 'system',
      setLanguagePreference() {},
      account: { homeAccountId: 'fixture' },
      profile: null,
      updateProfile() {},
      entitlement: null,
      storeSubscription: null,
      dataRetention: null,
      dataExportEnabled: false,
      reauthentication: null,
      clearReauthentication() {},
      reauthenticate() {},
      onSessionLost() {},
      signOut() {},
      publicWebHost: null,
      apiBaseUrl: '',
      appDownload: resolveAppDownload({}),
    }),
    [dictionary, language],
  );

  if (scene === 'landing') {
    return (
      <Landing
        businessFacts={[{ label: '상호', value: 'Juple' }]}
        dictionary={dictionary}
        notice={null}
        onSignIn={() => undefined}
      />
    );
  }

  let content: React.ReactNode;
  if (scene === 'home') content = <HomeView />;
  else if (scene === 'archive') content = <ArchiveView />;
  else if (scene === 'collections') content = <CollectionsView />;
  else if (scene === 'collection') content = <CollectionDetailsView collectionIdParam={query.get('cid') ?? '10'} />;
  else if (scene === 'save') content = <NewLinkReviewView url="https://www.youtube.com/watch?v=abc123" />;
  else if (scene === 'detail') {
    content = (
      <>
        <HomeView />
        {open ? (
          <QuickSheetFrame>
            <ItemDetailContent fromCollectionId={null} itemIdParam="7" lockedBy={null} onGone={() => setOpen(false)} onLeave={() => setOpen(false)} />
          </QuickSheetFrame>
        ) : null}
      </>
    );
  } else content = null;

  return (
    <div dir={isRtlLanguage(language) ? 'rtl' : 'ltr'} lang={language}>
      <SignedInAppContext.Provider value={value as never}>
        <ToastProvider>
          <SafetyProvider>
            <AppShell>{content}</AppShell>
          </SafetyProvider>
        </ToastProvider>
      </SignedInAppContext.Provider>
    </div>
  );
}
