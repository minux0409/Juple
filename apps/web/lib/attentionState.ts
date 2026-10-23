/** Portable badge policy/cache. Kept byte-identical with mobile/src/attention/attentionState.ts. */
export interface AttentionCollection {
  readonly id: number;
  readonly isFavorite: boolean;
  readonly accessRole?: string;
  readonly hasCollaborators?: boolean;
  readonly isPublicShareActive?: boolean;
  readonly attentionCount?: number;
  readonly unreadNewLinkCount?: number;
}
export interface AttentionInvitation { readonly invitationId: number }
export interface AttentionFriendRequest { readonly requestId: number; readonly direction: string }
export type AttentionResource = 'invitations' | 'friends' | 'collections';
export interface AttentionCounts {
  readonly home: number; readonly archive: number; readonly collections: number; readonly friends: number; readonly myPage: number;
  readonly types: Readonly<Record<'favorites' | 'all' | 'owned' | 'shared', number>>;
}
const countOf = (value: number | undefined) => Number.isFinite(value) ? Math.max(0, Math.floor(value!)) : 0;
const unique = <T,>(rows: readonly T[], id: (row: T) => number): readonly T[] => [...new Map(rows.map(row => [id(row), row])).values()];

/** Never sum tabs or add notification unread totals. Their event/task overlap is already resolved by the server. */
export function attentionCounts(invitations: readonly AttentionInvitation[], friends: readonly AttentionFriendRequest[], collections: readonly AttentionCollection[]): AttentionCounts {
  const types = { favorites: 0, all: 0, owned: 0, shared: unique(invitations, row => row.invitationId).length };
  for (const row of unique(collections, item => item.id)) {
    const attention = countOf(row.attentionCount);
    const owner = (row.accessRole ?? 'owner').toLowerCase() === 'owner';
    types.all += attention;
    if (row.isFavorite) types.favorites += attention;
    if (owner) types.owned += attention;
    if (!owner || row.hasCollaborators || row.isPublicShareActive) types.shared += attention;
  }
  const incoming = unique(friends, row => row.requestId).filter(row => row.direction.toLowerCase() === 'incoming').length;
  return { home: 0, archive: 0, collections: types.all + unique(invitations, row => row.invitationId).length, friends: incoming, myPage: incoming, types };
}

export const ATTENTION_CACHE_MS = 60_000;
export const ATTENTION_EVENT_MIN_MS = 2_000;

/** One store per authenticated account, never persisted. Partial failures preserve independently successful resources. */
export function createAttentionStore<I extends AttentionInvitation, F extends AttentionFriendRequest, C extends AttentionCollection>(loaders: {
  invitations: (active: () => boolean) => Promise<readonly I[]>; friends: (active: () => boolean) => Promise<readonly F[]>; collections: (active: () => boolean) => Promise<readonly C[]>;
}, now: () => number = Date.now) {
  type Data = { invitations: readonly I[] | null; friends: readonly F[] | null; collections: readonly C[] | null };
  type Snapshot = Data & { readonly counts: AttentionCounts };
  let data: Data = { invitations: null, friends: null, collections: null };
  let snapshot: Snapshot = { ...data, counts: attentionCounts([], [], []) };
  const listeners = new Set<() => void>();
  const versions = { invitations: 0, friends: 0, collections: 0 };
  const freshAt = { invitations: -Infinity, friends: -Infinity, collections: -Infinity };
  const attemptedAt = { invitations: -Infinity, friends: -Infinity, collections: -Infinity };
  const retryAt = { invitations: 0, friends: 0, collections: 0 };
  const failures: Partial<Record<AttentionResource, unknown>> = {};
  const pending: Partial<Record<AttentionResource, Promise<unknown>>> = {};
  const queued: Partial<Record<AttentionResource, ReturnType<typeof setTimeout>>> = {};
  let blockedUntil = 0;
  let disposed = false;
  function clearQueued(key: AttentionResource) {
    if (queued[key] !== undefined) { clearTimeout(queued[key]); delete queued[key]; }
  }
  function emit() {
    snapshot = { ...data, counts: attentionCounts(data.invitations ?? [], data.friends ?? [], data.collections ?? []) };
    for (const listener of [...listeners]) listener();
  }
  function replace<K extends AttentionResource>(key: K, rows: NonNullable<Data[K]>) {
    if (disposed) return;
    versions[key]++;
    delete pending[key];
    data = { ...data, [key]: rows };
    freshAt[key] = now();
    emit();
  }
  async function read<K extends AttentionResource>(key: K, force = false): Promise<NonNullable<Data[K]>> {
    if (disposed) throw new Error('Attention session ended');
    if (pending[key]) return pending[key] as Promise<NonNullable<Data[K]>>;
    if (!force && data[key] !== null && now() - freshAt[key] < ATTENTION_CACHE_MS) return data[key] as NonNullable<Data[K]>;
    if (now() < Math.max(blockedUntil, retryAt[key])) throw failures[key] ?? new Error('Attention refresh deferred');
    const mine = versions[key];
    clearQueued(key);
    attemptedAt[key] = now();
    const task = Promise.resolve().then(async () => {
      try {
        if (disposed || versions[key] !== mine) throw new Error('Attention session changed');
        const rows = await loaders[key](() => !disposed && versions[key] === mine);
        if (disposed) throw new Error('Attention session ended');
        if (versions[key] === mine) {
          data = { ...data, [key]: rows };
          freshAt[key] = now();
          retryAt[key] = 0;
          delete failures[key];
          emit();
        }
        if (data[key] === null) throw new Error('Superseded attention response');
        return data[key] as NonNullable<Data[K]>;
      } catch (error) {
        if (!disposed && versions[key] === mine) {
          failures[key] = error;
          retryAt[key] = now() + 15_000;
          const refusal = error as { status?: number; retryAfterSeconds?: number };
          if (refusal?.status === 429) {
            const seconds = Number.isFinite(refusal.retryAfterSeconds) ? refusal.retryAfterSeconds! : 60;
            blockedUntil = Math.max(blockedUntil, now() + Math.max(1, seconds) * 1000);
          }
        }
        throw error;
      } finally {
        if (pending[key] === task) delete pending[key];
      }
    });
    pending[key] = task;
    return task;
  }
  return {
    getSnapshot: () => snapshot,
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    read, replace,
    refresh: (resources: readonly AttentionResource[] = ['invitations', 'friends', 'collections'], event = false) => Promise.allSettled(resources.map(key => {
      if (event && now() - attemptedAt[key] < ATTENTION_EVENT_MIN_MS) {
        // Keep the last event in a burst: dropping it could leave a new invitation invisible indefinitely.
        if (queued[key] === undefined) queued[key] = setTimeout(() => {
          delete queued[key];
          const mine = versions[key];
          const refresh = () => { if (!disposed && versions[key] === mine) void read(key, true).catch(() => undefined); };
          if (pending[key]) void pending[key]!.catch(() => undefined).then(refresh);
          else refresh();
        }, ATTENTION_EVENT_MIN_MS - (now() - attemptedAt[key]));
        return Promise.resolve();
      }
      return read(key, event);
    })),
    removeInvitation: (id: number) => { if (data.invitations) replace('invitations', data.invitations.filter(row => row.invitationId !== id)); },
    removeFriendRequest: (id: number) => { if (data.friends) replace('friends', data.friends.filter(row => row.requestId !== id)); },
    collectionChanged: (row: C) => {
      if (data.collections) replace('collections', [...data.collections.filter(old => old.id !== row.id), row]);
    },
    newLinksRead: (id?: number) => {
      if (data.collections) replace('collections', data.collections.map(row => id === undefined || row.id === id
        ? { ...row, attentionCount: Math.max(0, countOf(row.attentionCount) - countOf(row.unreadNewLinkCount)), unreadNewLinkCount: 0 } : row));
    },
    dispose: () => {
      disposed = true;
      for (const key of ['invitations', 'friends', 'collections'] as const) { versions[key]++; delete pending[key]; clearQueued(key); }
      data = { invitations: null, friends: null, collections: null };
      emit();
    },
    reset: () => {
      for (const key of ['invitations', 'friends', 'collections'] as const) {
        versions[key]++; delete pending[key]; clearQueued(key); delete failures[key]; freshAt[key] = -Infinity; attemptedAt[key] = -Infinity; retryAt[key] = 0;
      }
      blockedUntil = 0;
      data = { invitations: null, friends: null, collections: null };
      emit();
    },
  };
}

/** Fetch all metadata pages atomically, not a false total from the first page. No notification history scan. */
export async function loadAttentionCollections<C extends AttentionCollection>(fetchPage: (path: string) => Promise<{ items: readonly C[]; nextCursor: string | null }>, active: () => boolean = () => true): Promise<readonly C[]> {
  const rows: C[] = [];
  const seen = new Set<string>();
  let cursor: string | null = null;
  do {
    if (!active()) throw new Error('Attention pagination cancelled');
    const path = '/api/v1/collections?scope=all&limit=100' + (cursor ? `&cursor=${encodeURIComponent(cursor)}` : '');
    const page = await fetchPage(path);
    if (!active()) throw new Error('Attention pagination cancelled');
    rows.push(...page.items);
    cursor = page.nextCursor;
    if (cursor) {
      if (seen.has(cursor)) throw new Error('Repeated attention cursor');
      seen.add(cursor);
    }
  } while (cursor !== null);
  return unique(rows, row => row.id);
}
