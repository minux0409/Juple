'use client';
// Local browser regression only. No token source and no network API: every operation uses fixtures.
import { useMemo } from 'react';
import Link from 'next/link';
import { SignedInAppContext } from '../(app)/AppRoot';
import { CollectionsView } from '../(app)/collections/CollectionsView';
import { ToastProvider } from '../(app)/Toaster';
import { getAppDictionary } from '../../lib/appDictionary';
import { ApiHttpError } from '../../lib/appApi';
import { COLLECTION_INVITATIONS_HREF } from '../../lib/collectionInvitations';

export default function Page() {
  const value = useMemo(() => {
    let pending = [1, 2, 3];
    let accepted = false;
    const api = async ({ path, method = 'GET' }: { path: string; method?: string }) => {
      const calls = JSON.parse(sessionStorage.getItem('invitationCalls') ?? '[]');
      calls.push(`${method} ${path}`);
      sessionStorage.setItem('invitationCalls', JSON.stringify(calls));
      await new Promise(resolve => setTimeout(resolve, 100));
      if (path === '/api/v1/users/me/collection-invitations') return { items: pending.map(id => ({ invitationId: id, collectionId: id, collectionName: `Invite ${id}`, ownerJupleId: 'TEST-OWNER', ownerDisplayName: 'Test owner', role: 'viewer', createdAtUtc: '2026-10-23T00:00:00Z', expiresAtUtc: '2026-10-30T00:00:00Z' })) };
      if (path.startsWith('/api/v1/collection-invitations/') && method === 'POST') {
        const id = Number(path.split('/')[4]);
        pending = pending.filter(value => value !== id);
        if (id === 3) throw new ApiHttpError(409, 'invitationNotPending');
        if (path.endsWith('/accept')) accepted = true;
        return undefined;
      }
      if (path.startsWith('/api/v1/collections?')) return { items: accepted ? [{ id: 1, name: 'Accepted collection', icon: 'Folder', color: null, itemCount: 0, isFavorite: false, accessRole: 'viewer' }] : [], nextCursor: null };
      return { items: [], nextCursor: null };
    };
    return { api, dictionary: getAppDictionary('ko'), locale: 'ko', languagePreference: 'system', onSessionLost() {}, profile: null, account: {}, appDownload: {}, setLanguagePreference() {} };
  }, []);
  return <SignedInAppContext.Provider value={value as never}><ToastProvider>
    <Link href={`/invitation-test-harness${COLLECTION_INVITATIONS_HREF.slice('/collections'.length)}`}>Invitation notification</Link>
    <CollectionsView />
  </ToastProvider></SignedInAppContext.Provider>;
}
