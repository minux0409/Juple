'use client';
// Local browser regression only. No token source and no network API: every operation uses fixtures.
// Renders the REAL Quick Detail sheet (QuickSheetFrame + the real content components) with a delayed fixture API and samples the panel's size
// on every animation frame from mount, so a jump in size is measured, not guessed.
import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { SignedInAppContext } from '../(app)/AppRoot';
import { ToastProvider } from '../(app)/Toaster';
import { SafetyProvider } from '../(app)/SafetyProvider';
import { getAppDictionary } from '../../lib/appDictionary';
import { QuickSheetFrame } from '../(app)/items/[itemId]/QuickDetailSheet';
import { ItemDetailContent } from '../(app)/items/[itemId]/ItemDetailContent';
import { SharedItemQuickContent } from '../(app)/collections/[collectionId]/items/[itemId]/SharedItemContent';
import { resolveAppDownload } from '../../lib/appDownload';
import { ApiHttpError } from '../../lib/appApi';
import styles from '../(app)/app.module.css';
import { subscribeItemsChanged } from '../../lib/itemChanges';

type Sample = { t: number; h: number; w: number; top: number };

function createApi(delayMs: number, role: string, deleteFails: boolean) {
  return async ({ path, method = 'GET' }: { path: string; method?: string }) => {
    const calls = JSON.parse(sessionStorage.getItem('quickCalls') ?? '[]');
    calls.push(`${method} ${path}`);
    sessionStorage.setItem('quickCalls', JSON.stringify(calls));
    await new Promise(resolve => setTimeout(resolve, delayMs));
    const clean = path.split('?')[0];
    if (clean === '/api/v1/items/7') return { id: 7, url: 'https://www.youtube.com/watch?v=abc', title: '내 링크 - 보관함에서 열기', memo: '메모', savedAtUtc: '2026-10-23T00:00:00Z', previewImageUrl: null, coverImage: null };
    if (clean === '/api/v1/items/7/images') return { images: [] };
    if (clean === '/api/v1/collections/10') return { id: 10, name: '웹툰', icon: 'Folder', color: 'Blue', itemCount: 3, isFavorite: false, accessRole: role, hasCollaborators: true };
    if (method === 'DELETE' && /^\/api\/v1\/collections\/10\/items\/\d+$/.test(clean)) {
      if (deleteFails) throw new ApiHttpError(403, 'forbidden');
      return undefined;
    }
    if (path.startsWith('/api/v1/collections?')) return { items: [{ id: 10, name: '웹툰', icon: 'Folder', color: 'Blue', itemCount: 3, isFavorite: false, accessRole: 'owner' }], nextCursor: null };
    if (/^\/api\/v1\/collections\/10\/items\/\d+$/.test(clean)) {
      const id = Number(clean.split('/')[6]);
      return { itemId: id, url: 'https://www.youtube.com/watch?v=abc', title: id === 7 ? '내 링크 - 보관함에서 열기' : '다른 사람이 올린 링크', previewImageUrl: null, addedAtUtc: '2026-10-23T00:00:00Z', isMine: id === 7, addedBy: { kind: id === 7 ? 'me' : 'member', jupleId: 'TEST-ADDER', displayName: 'Adder' }, reactions: [{ key: 'heart', count: 2 }], myReaction: null };
    }
    if (/\/comments$/.test(clean)) {
      return { items: [1, 2, 3].map(id => ({ id, body: `댓글 ${id} - 조금 긴 댓글 내용이 들어갑니다`, createdAtUtc: '2026-10-23T00:00:00Z', author: { jupleId: 'TEST-ADDER', displayName: 'Adder', profileImageUrl: null, profileImageVersion: null, isCollectionOwner: false, isMe: false }, replyCount: 0, likeCount: 0, viewerLiked: false })), previousCursor: null, totalCount: 3 };
    }
    return undefined;
  };
}

export default function Page() {
  const query = useSearchParams();
  const kind = query.get('kind') ?? 'item';
  const delay = Number(query.get('delay') ?? 150);
  const failure = query.get('failure') === '1';
  const role = query.get('role') ?? 'owner';
  const deleteFails = query.get('deleteFails') === '1';
  const value = useMemo(() => ({ api: failure ? (async () => { await new Promise(resolve => setTimeout(resolve, delay)); throw new Error('offline'); }) : createApi(delay, role, deleteFails), dictionary: getAppDictionary('ko'), locale: 'ko', languagePreference: 'system', setLanguagePreference() {}, account: { homeAccountId: 'A' }, profile: null, updateProfile() {}, entitlement: null, storeSubscription: null, dataRetention: null, dataExportEnabled: false, reauthentication: null, clearReauthentication() {}, reauthenticate() {}, onSessionLost() {}, signOut() {}, publicWebHost: null, apiBaseUrl: '', appDownload: resolveAppDownload({}) }), [delay, failure, role, deleteFails]);
  const [open, setOpen] = useState(false);
  // What the Collection's list would hear: recorded, so a test can tell "removed from the Collection" from "deleted".
  useEffect(() => subscribeItemsChanged(change => {
    const seen = JSON.parse(sessionStorage.getItem('quickChanges') ?? '[]');
    seen.push(change);
    sessionStorage.setItem('quickChanges', JSON.stringify(seen));
  }), []);
  const [mounts, setMounts] = useState(0);

  // One sample per frame, from the moment the sheet is opened until it is closed.
  useEffect(() => {
    if (!open) return undefined;
    const samples: Sample[] = [];
    const started = performance.now();
    let raf = 0;
    const loop = () => {
      const panel = document.querySelector('dialog[open] [data-quick-panel], dialog[open] > div');
      if (panel) {
        const r = (panel as HTMLElement).getBoundingClientRect();
        samples.push({ t: Math.round(performance.now() - started), h: Math.round(r.height), w: Math.round(r.width), top: Math.round(r.top) });
        (window as unknown as { __samples: Sample[] }).__samples = samples;
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [open]);

  return (
    <SignedInAppContext.Provider value={value as never}>
      <ToastProvider>
       <SafetyProvider>
        <main className={styles.shell} style={{ display: 'block', padding: 24 }}>
          <button data-open-sheet onClick={() => { setOpen(true); }} type="button">open {kind}</button>
          <span data-mounts>{mounts}</span>
          {open ? (
            <QuickSheetFrame>
              <Counter onMount={() => setMounts(count => count + 1)} />
              {kind === 'shared' ? (
                <SharedItemQuickContent collectionIdParam="10" itemIdParam="2" />
              ) : kind === 'own-in-collection' ? (
                <ItemDetailContent fromCollectionId={10} itemIdParam="7" lockedBy={null} onGone={() => setOpen(false)} onLeave={() => setOpen(false)} />
              ) : (
                <ItemDetailContent fromCollectionId={null} itemIdParam="7" lockedBy={null} onGone={() => setOpen(false)} onLeave={() => setOpen(false)} />
              )}
            </QuickSheetFrame>
          ) : null}
        </main>
       </SafetyProvider>
      </ToastProvider>
    </SignedInAppContext.Provider>
  );
}

/** Counts how many times the sheet's content is mounted (a re-mount would show as a second count). */
let nextInstance = 0;
function Counter({ onMount }: { onMount: () => void }) {
  // One id per component INSTANCE: React's development double-run of effects is the same instance (counted once); a re-mount is a new one.
  const [id] = useState(() => ++nextInstance);
  useEffect(() => {
    const seen = (window as unknown as { __instances?: Set<number> }).__instances ?? ((window as unknown as { __instances: Set<number> }).__instances = new Set());
    if (!seen.has(id)) {
      seen.add(id);
      onMount();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return null;
}
