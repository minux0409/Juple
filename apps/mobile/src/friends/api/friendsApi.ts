import type { AuthenticatedApiRequest } from '../../api/useAuthenticatedApi';

/**
 * Friends: a personal address book of other Juple users (exact Juple ID + mutual consent). A
 * friendship grants no access to anything - Collections are still shared only by invitation.
 * People are identified by Juple ID and their chosen display name; myNote is the signed-in user's
 * own private note and is never shown to anyone else.
 */
export interface Friend {
  readonly friendshipId: number;
  readonly jupleId: string;
  readonly displayName: string | null;
  readonly myNote: string | null;
  readonly friendsSinceUtc: string;
  /** The friend's own profile photo (signed URL + stable version) - both absent/null without one. */
  readonly profileImageUrl?: string | null;
  readonly profileImageVersion?: string | null;
}

export type FriendRequestDirection = 'incoming' | 'outgoing';

export interface FriendRequest {
  readonly requestId: number;
  readonly jupleId: string;
  readonly displayName: string | null;
  readonly direction: FriendRequestDirection;
  readonly createdAtUtc: string;
  readonly profileImageUrl?: string | null;
  readonly profileImageVersion?: string | null;
}

export interface FriendsPage {
  readonly items: readonly Friend[];
  readonly nextCursor: string | null;
}

/** Mirrors the Backend's FriendNoteText limits: 200 user-perceived characters, 1000 UTF-16 units. */
export const FRIEND_NOTE_MAX_LENGTH = 200;
export const FRIEND_NOTE_MAX_STORAGE_LENGTH = 1000;

/** Searches only within the signed-in user's own friends (name, Juple ID, my note) - never a directory. */
export async function getFriends(
  request: AuthenticatedApiRequest,
  options: { readonly query?: string; readonly cursor?: string; readonly limit?: number } = {},
): Promise<FriendsPage> {
  const query = new URLSearchParams();
  if (options.query) {
    query.set('query', options.query);
  }
  if (options.cursor) {
    query.set('cursor', options.cursor);
  }
  if (options.limit !== undefined) {
    query.set('limit', String(options.limit));
  }
  const queryString = query.toString();
  const response = await request<FriendsPage>({
    method: 'GET',
    path: `/api/v1/friends${queryString ? `?${queryString}` : ''}`,
  });
  return response.body ?? { items: [], nextCursor: null };
}

export async function getFriendRequests(request: AuthenticatedApiRequest): Promise<readonly FriendRequest[]> {
  const response = await request<{ items: readonly FriendRequest[] }>({ method: 'GET', path: '/api/v1/friends/requests' });
  return response.body?.items ?? [];
}

/**
 * Exact Juple ID. Rejects with ApiError: notFound (no such ID), badRequest (yourself), conflict with
 * code alreadyFriends / requestPending / incomingRequestExists (answer that request instead),
 * tooManyRequests.
 */
export async function sendFriendRequest(request: AuthenticatedApiRequest, jupleId: string): Promise<FriendRequest> {
  const response = await request<FriendRequest>({ method: 'POST', path: '/api/v1/friends/requests', body: { jupleId } });
  if (!response.body) {
    throw new Error('Juple API returned no friend request.');
  }
  return response.body;
}

export async function acceptFriendRequest(request: AuthenticatedApiRequest, requestId: number): Promise<Friend> {
  const response = await request<Friend>({ method: 'POST', path: `/api/v1/friends/requests/${requestId}/accept` });
  if (!response.body) {
    throw new Error('Juple API returned no friend.');
  }
  return response.body;
}

export async function declineFriendRequest(request: AuthenticatedApiRequest, requestId: number): Promise<void> {
  await request<void>({ method: 'POST', path: `/api/v1/friends/requests/${requestId}/decline` });
}

export async function cancelFriendRequest(request: AuthenticatedApiRequest, requestId: number): Promise<void> {
  await request<void>({ method: 'DELETE', path: `/api/v1/friends/requests/${requestId}` });
}

/** Removes the friendship and both private notes; shared Collections are not affected. */
export async function removeFriend(request: AuthenticatedApiRequest, friendshipId: number): Promise<void> {
  await request<void>({ method: 'DELETE', path: `/api/v1/friends/${friendshipId}` });
}

/** Sets the signed-in user's own note (empty clears it). */
export async function setFriendNote(request: AuthenticatedApiRequest, friendshipId: number, note: string): Promise<Friend> {
  const response = await request<Friend>({ method: 'PUT', path: `/api/v1/friends/${friendshipId}/note`, body: { note } });
  if (!response.body) {
    throw new Error('Juple API returned no friend.');
  }
  return response.body;
}
