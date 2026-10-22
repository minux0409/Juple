'use client';
// Test-only (copied to app/browser-test-harness/ by tests/browser/lockedCollection.browser.mjs and deleted afterwards).
import { useMemo, type ReactNode } from 'react';
import { SignedInAppContext } from '../(app)/AppRoot';
import { ApiHttpError } from '../../lib/appApi';
import { getAppDictionary } from '../../lib/appDictionary';

const plain = { id: 1, name: 'plain', icon: 'Folder', color: null, itemCount: 0, isFavorite: false, accessRole: 'owner' };
const locked = { id: 5, name: 'test', icon: 'Folder', color: null, itemCount: 0, isFavorite: false, isLocked: true, accessRole: 'owner' };

/** Every call is recorded in sessionStorage (it survives a page load, so a stray full navigation cannot hide what happened). */
function record(key: string, value: string) {
  const list = JSON.parse(sessionStorage.getItem(key) ?? '[]') as string[];
  list.push(value);
  sessionStorage.setItem(key, JSON.stringify(list));
}

export function StubApp({ children }: { readonly children: ReactNode }) {
  const value = useMemo(() => {
    const api = async (request: { method?: string; path: string; body?: unknown }) => {
      const method = request.method ?? 'GET';
      record('api', `${method} ${request.path}`);
      // Anything that is not a read - and is not the password check itself - would be a save of the link or of its Collections.
      if (method !== 'GET' && !request.path.endsWith('/unlock') && request.path !== '/api/v1/url-metadata/resolve') {
        record('writes', `${method} ${request.path}`);
      }
      await new Promise(resolve => setTimeout(resolve, 30));
      if (request.path === '/api/v1/url-metadata/resolve') return { title: 'Title', previewImageUrl: null };
      if (request.path === '/api/v1/items/7') return { id: 7, url: 'https://example.com/a', title: 'T', memo: '', savedAtUtc: new Date().toISOString(), previewImageUrl: null, coverImage: null };
      if (request.path === '/api/v1/items/7/images') return { images: [] };
      if (request.path.startsWith('/api/v1/collections?')) {
        if (request.path.includes('itemId=7')) return { items: [plain], nextCursor: null };
        return { items: request.path.includes('scope=owned') ? [plain, locked] : [], nextCursor: null };
      }
      if (request.path === '/api/v1/collections/1') return plain;
      if (request.path === '/api/v1/collections/5') return locked;
      if (request.path === '/api/v1/collections/5/unlock') {
        if ((request.body as { password: string }).password !== 'right') throw new ApiHttpError(403, 'invalidCollectionPassword');
        return { unlockToken: 'grant', expiresAtUtc: new Date(Date.now() + 600_000).toISOString() };
      }
      return undefined;
    };
    return {
      api, dictionary: getAppDictionary('ko'), locale: 'ko', languagePreference: 'system', setLanguagePreference() {}, account: {}, profile: null,
      updateProfile() {}, entitlement: null, storeSubscription: null, dataRetention: null, dataExportEnabled: false, reauthentication: null,
      clearReauthentication() {}, reauthenticate() {}, onSessionLost() {}, signOut() {}, publicWebHost: null, apiBaseUrl: '', appDownload: {},
    };
  }, []);
  return (
    <SignedInAppContext.Provider value={value as never}>
      <main>{children}</main>
    </SignedInAppContext.Provider>
  );
}
