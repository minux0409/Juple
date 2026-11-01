import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuthenticatedApi } from '../api/useAuthenticatedApi';
import { listBlockedUsers } from './safetyApi';

export type BlockedUsersStatus = 'loading' | 'ready' | 'error';

type BlockChange = (jupleId: string, blocked: boolean) => void;

// Only change notifications travel between screens - never the list itself - so nothing outlives a sign-out: every screen that needs
// the state reads it from the server when it mounts, and applies the changes made elsewhere while it is open.
const listeners = new Set<BlockChange>();

/** Tells every open screen that the server accepted a block (true) or an unblock (false) of this person. */
export function publishBlockChange(jupleId: string, blocked: boolean) {
  [...listeners].forEach(listener => listener(jupleId, blocked));
}

/** For a screen that must react to a block / unblock the server just accepted (for example a Collection screen that may have lost its membership). */
export function subscribeBlockChanges(listener: BlockChange): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Who I have blocked, as the server says (`GET /api/v1/users/me/blocked-users`): the one source for a menu or profile that must show
 * 사용자 차단 or 차단 해제. `status` is 'ready' only after the server answered - while it is loading or failed, nothing may start a block
 * (the state is unknown). Changes made on another screen arrive through `publishBlockChange`. `enabled = false` is for a screen whose people are
 * known not to be blocked (the friends list: a block ends the friendship), which then asks the server nothing.
 */
export function useBlockedUsers(enabled = true) {
  const request = useAuthenticatedApi();
  const [status, setStatus] = useState<BlockedUsersStatus>(enabled ? 'loading' : 'ready');
  const [blockedIds, setBlockedIds] = useState<ReadonlySet<string>>(() => new Set());
  const requestRef = useRef(0);
  // Read through a ref: a new `request` identity must never restart the load.
  const apiRef = useRef(request);
  apiRef.current = request;

  const refresh = useCallback(async () => {
    if (!enabled) {
      return;
    }
    const mine = ++requestRef.current;
    setStatus(previous => (previous === 'ready' ? previous : 'loading'));
    try {
      const people = await listBlockedUsers(apiRef.current);
      if (mine === requestRef.current) {
        setBlockedIds(new Set(people.map(person => person.jupleId)));
        setStatus('ready');
      }
    } catch {
      if (mine === requestRef.current) {
        setStatus(previous => (previous === 'ready' ? previous : 'error'));
      }
    }
  }, [enabled]);

  useEffect(() => {
    refresh().catch(() => undefined);
  }, [refresh]);

  useEffect(() => {
    const apply: BlockChange = (jupleId, blocked) => {
      // Shown at once, then confirmed by the server's own list (which also supersedes any list still in flight).
      setBlockedIds(previous => {
        const next = new Set(previous);
        if (blocked) {
          next.add(jupleId);
        } else {
          next.delete(jupleId);
        }
        return next;
      });
      refresh().catch(() => undefined);
    };
    listeners.add(apply);
    return () => {
      listeners.delete(apply);
    };
  }, [refresh]);

  const isBlocked = useCallback((jupleId: string) => blockedIds.has(jupleId), [blockedIds]);
  return { status, isBlocked, refresh } as const;
}
