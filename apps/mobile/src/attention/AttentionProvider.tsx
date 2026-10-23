import { useEffect, useLayoutEffect, useMemo, type ReactNode } from 'react';
import { AppState } from 'react-native';
import { useAuth } from '../auth/AuthContext';
import { decodeIdTokenClaims } from '../auth/idTokenClaims';
import { getCachedIdToken } from '../auth/session/authSessionManager';
import { useAuthenticatedApi } from '../api/useAuthenticatedApi';
import { subscribeSocialPushEvents } from '../push/pushEvents';
import { subscribeCollectionNewLinksRead } from '../notifications/notificationState';
import { bindMobileAttention, createMobileAttentionStore } from './mobileAttention';
import { AttentionContext } from './attentionContext';

export function AttentionProvider({ children }: { readonly children: ReactNode }) {
  const auth = useAuth();
  const request = useAuthenticatedApi();
  const ready = auth.isAuthenticated && !auth.isSigningIn && auth.backendAuthStatus === 'valid' && auth.userBootstrapStatus === 'ready';
  const token = ready ? getCachedIdToken() : null;
  const claims = token ? decodeIdTokenClaims(token) : null;
  // Cache identity only, never authorization; never persisted or logged. A different account gets an empty store during render.
  const accountKey = ready ? `${claims?.tid ?? ''}:${claims?.oid ?? claims?.sub ?? token ?? 'current-session'}` : '';
  // The identity dependency intentionally resets all cached counts before an account switch paints.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const store = useMemo(() => createMobileAttentionStore(request), [request, accountKey]);
  useLayoutEffect(() => ready ? bindMobileAttention(store, request) : undefined, [ready, request, store]);
  useEffect(() => {
    if (!ready) return;
    let active = true;
    void store.refresh();
    const foreground = AppState.addEventListener('change', state => { if (active && state === 'active') void store.refresh(); });
    const unsubscribe = subscribeSocialPushEvents(event => {
      if (!active) return;
      if (event.type.startsWith('friendRequest')) void store.refresh(['friends'], true);
      else if (event.type.startsWith('collectionInvitation')) void store.refresh(['invitations', 'collections'], true);
      else if (!['collectionItemComment', 'collectionItemReaction', 'commentReply', 'commentLike', 'collectionLinkShared'].includes(event.type)) void store.refresh(['collections'], true);
    });
    const read = subscribeCollectionNewLinksRead(id => store.newLinksRead(id));
    return () => { active = false; foreground.remove(); unsubscribe(); read(); };
  }, [ready, store]);
  return <AttentionContext.Provider value={store}>{children}</AttentionContext.Provider>;
}
