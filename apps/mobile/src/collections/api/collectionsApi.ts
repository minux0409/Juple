import type { AuthenticatedApiRequest } from '../../api/useAuthenticatedApi';
import type { RepresentativeImage } from '../../images/api/imagesApi';
import { COLLECTION_UNLOCK_HEADER_NAME, getCollectionUnlockToken, storedUnlockHeaders } from '../collectionUnlockGrants';

/** A named 보관함 - an Item can belong to any number of Collections at once (unlike Category). */
/** The caller's relationship to a Collection - always stated by the server, never inferred client-side. */
export type CollectionAccessRole = 'owner' | 'contributor' | 'viewer' | 'submitter';

export interface Collection {
  readonly id: number;
  readonly name: string;
  /**
   * Collaboration/lock state (optional on the type only so older fixtures/responses still read as
   * an owned, unlocked, unshared Collection - see isSharedWithMe/isCollectionLocked below).
   * "contributor": shared with the caller by ownerJupleId; the caller may view and add their own
   * links only. "viewer": shared view-only - the caller may only look (and keep their own favorite
   * mark). "submitter" (승인 후 추가): like a viewer, and the caller's links are proposals that join
   * only once the Owner approves them. isFavorite is always the caller's own mark, never the Owner's.
   */
  readonly accessRole?: CollectionAccessRole;
  readonly isLocked?: boolean;
  /** Owner view only: the Collection has at least one Contributor. */
  readonly hasCollaborators?: boolean;
  /** Owner view only: its 모든 사용자 (public) link is on. */
  readonly isPublicShareActive?: boolean;
  /**
   * The Owner's photo used as this Collection's icon - a short-lived read URL, shown instead of the
   * built-in `icon` glyph (which stays as the fallback). Null/absent: no photo.
   */
  readonly iconImageUrl?: string | null;
  /**
   * Stable identity of that photo: the same while it stays, new once it is replaced, null with no
   * photo. The image cache keys on this (see collectionIconImageCache) - never on the signed URL,
   * which is different in every response. Absent from an older server.
   */
  readonly iconImageVersion?: string | null;
  /**
   * The Collection has its own share password: members and public-link visitors must prove it
   * before its content opens; the Owner never does. Absent from an older server (read as false).
   * Separate from isLocked, which for a member only ever means a legacy Collection still opening
   * with its Owner's lock password.
   */
  readonly isSharePasswordProtected?: boolean;
  /** Owner view only: how many proposed links (승인 후 추가) wait for the Owner's approval. */
  readonly pendingSubmissionCount?: number;
  /** Contributor view only: the Owner's public Juple ID. */
  readonly ownerJupleId?: string | null;
  /** Contributor view only: the Owner's chosen display name (null when they have not set one). */
  readonly ownerDisplayName?: string | null;
  /**
   * Collaborative Collections only: up to two OTHER participants (never the caller) - the Owner
   * first, then Contributors in joining order - and how many other participants there are in all.
   * Pending invitations are never participants. See formatParticipantSummary.
   */
  readonly participantPreview?: readonly CollectionParticipant[] | null;
  readonly otherParticipantCount?: number;
  /**
   * The CALLER's own favorite mark (Owner or Contributor alike) - personal, never anyone else's,
   * and never shared with the other participants.
   */
  readonly isFavorite: boolean;
  readonly itemCount: number;
  readonly createdAtUtc: string;
  readonly updatedAtUtc: string;
  /**
   * One of the fixed CollectionIcon keys the server defines (see collectionIcons.ts) - a plain
   * string wire type, not a union, so an icon key this build doesn't yet recognize (e.g. added by a
   * later server release) still round-trips safely and falls back to the default glyph, rather than
   * this type itself going stale.
   */
  readonly icon: string;
  /**
   * One of the fixed CollectionColor keys the server defines (see collectionColors.ts), or null when
   * no explicit color was ever chosen (a legacy row, or one seeded without one) - a plain nullable
   * string wire type, not a union, for the same forward-compatibility reason as `icon`. null must be
   * treated as "fall back to the existing id-deterministic palette" (see CategoryIconTile), never as
   * a color choice in its own right.
   */
  readonly color: string | null;
}

/** A member of a collaborative Collection, identified only by public Juple ID and chosen display name. */
export interface CollectionParticipant {
  readonly jupleId: string;
  readonly displayName: string | null;
  /** "owner", "contributor" or "viewer". */
  readonly role: string;
  /** Only in a full participant list: marks the signed-in user. */
  readonly isMe?: boolean;
  /** Only in a full participant list: the person's profile photo (signed URL + stable version). */
  readonly profileImageUrl?: string | null;
  readonly profileImageVersion?: string | null;
}

/**
 * One Item inside a Collection. SortOrder is the owner's manual display order (ascending) - see
 * moveCollectionItem; do not re-derive numbering from array position alone once reordering is in
 * play. representativeImage/previewImageUrl/coverImage mirror ItemHistoryEntry's own three
 * thumbnail sources exactly (see resolveEffectiveThumbnailUrl) - this used to omit the latter two,
 * which was the root cause of Category showing no thumbnail for Items whose image came from a
 * cover choice or metadata preview rather than an uploaded image.
 */
export interface CollectionItemEntry {
  readonly itemId: number;
  readonly url: string;
  readonly title: string | null;
  readonly memo: string | null;
  readonly addedAtUtc: string;
  readonly sortOrder: number;
  readonly representativeImage: RepresentativeImage | null;
  readonly previewImageUrl: string | null;
  readonly coverImage: RepresentativeImage | null;
  /**
   * False for a link another member of a shared Collection owns - then memo/representativeImage/
   * coverImage are always null (private to that member) and it opens as the read-only shared view,
   * never the owner-only ItemDetails. Undefined (older fixtures) reads as true.
   */
  readonly isMine?: boolean;
  /** Who put this link into this Collection (see CollectionItemAdder); null/undefined when unknown. */
  readonly addedBy?: CollectionItemAdder | null;
}

/**
 * Who added a link to a Collection, as the server lets the caller see them: "me"; the "owner" or a
 * current "member" by public identity and profile photo (the same the participant list shows); or
 * "publicLink" - added through the 모든 사용자 link by someone who is not a participant, never
 * identified. isCollectionOwner: the adder is this Collection's Owner (also when that is "me").
 * Only in signed-in member views - the public link page never receives an adder.
 */
export interface CollectionItemAdder {
  readonly kind: 'me' | 'owner' | 'member' | 'publicLink';
  readonly jupleId?: string | null;
  readonly displayName?: string | null;
  readonly profileImageUrl?: string | null;
  readonly profileImageVersion?: string | null;
  readonly isCollectionOwner?: boolean;
}

export interface CollectionItemsPage {
  readonly items: readonly CollectionItemEntry[];
  readonly nextCursor: string | null;
}

export interface CollectionsPage {
  readonly items: readonly Collection[];
  readonly nextCursor: string | null;
}

export interface GetCollectionsOptions {
  readonly limit?: number;
  /** Opaque value from a previous CollectionsPage.nextCursor; never parsed or modified. */
  readonly cursor?: string;
  /** Restricts the list to Collections that already contain this Item (see ItemDetailsScreen's membership chip list) - composes with limit/cursor, not a separate contract. Mutually exclusive with excludeItemId. */
  readonly itemId?: number;
  /** Restricts the list to Collections that do NOT yet contain this Item (see the "add to collection" modal) - the server excludes them, so a Collection the Item already belongs to can never resurface as a candidate on any page. Mutually exclusive with itemId. */
  readonly excludeItemId?: number;
  /** Restricts the list to favorited (or, if false, non-favorited) Collections - an independent filter that composes with itemId/excludeItemId, not mutually exclusive with either. */
  readonly isFavorite?: boolean;
  /**
   * "owned" (default when omitted - the Collections the caller owns, unchanged behavior), "shared"
   * (shared with the caller, plus the caller's own currently-shared ones - which are therefore in
   * "owned" too), "all" (owned + shared with the caller, each once, one server-side ordering) or
   * "favorites" (all, only the caller's own favorites). isFavorite only applies to "owned".
   */
  readonly scope?: CollectionListScope;
}

export type CollectionListScope = 'owned' | 'shared' | 'all' | 'favorites';

/** Collection is a growing user data set - always cursor-paginated, never returns everything in one response. */
export async function getCollections(
  request: AuthenticatedApiRequest,
  options: GetCollectionsOptions = {},
): Promise<CollectionsPage> {
  const query = new URLSearchParams();
  if (options.itemId !== undefined) {
    query.set('itemId', String(options.itemId));
  }
  if (options.excludeItemId !== undefined) {
    query.set('excludeItemId', String(options.excludeItemId));
  }
  if (options.isFavorite !== undefined) {
    query.set('isFavorite', String(options.isFavorite));
  }
  if (options.scope !== undefined) {
    query.set('scope', options.scope);
  }
  if (options.limit !== undefined) {
    query.set('limit', String(options.limit));
  }
  if (options.cursor) {
    query.set('cursor', options.cursor);
  }
  const queryString = query.toString();

  const response = await request<CollectionsPage>({
    method: 'GET',
    path: queryString ? `/api/v1/collections?${queryString}` : '/api/v1/collections',
  });

  if (!response.body) {
    throw new Error('Juple API returned no Collections page body.');
  }

  return response.body;
}

/**
 * POSTs a new Collection; resolves with the created Collection on 201 (409 on a duplicate name).
 * icon/color are optional - omitting either (e.g. the New Link Review quick-create field, which has
 * no color picker) lets the server apply its own defaults (Folder / Blue) rather than this client
 * guessing one.
 */
export async function createCollection(
  request: AuthenticatedApiRequest,
  name: string,
  icon?: string,
  color?: string,
): Promise<Collection> {
  const response = await request<Collection>({
    method: 'POST',
    path: '/api/v1/collections',
    body: { name, icon, color },
  });

  if (!response.body) {
    throw new Error('Juple API returned no Collection body.');
  }

  return response.body;
}

export async function getCollection(
  request: AuthenticatedApiRequest,
  collectionId: number,
): Promise<Collection> {
  const response = await request<Collection>({
    method: 'GET',
    path: `/api/v1/collections/${collectionId}`,
  });

  if (!response.body) {
    throw new Error('Juple API returned no Collection body.');
  }

  return response.body;
}

/** PUTs a Collection's new name; resolves on 204 (409 on a duplicate name). */
export async function renameCollection(
  request: AuthenticatedApiRequest,
  collectionId: number,
  name: string,
): Promise<void> {
  await request<void>({
    method: 'PUT',
    path: `/api/v1/collections/${collectionId}`,
    body: { name },
    headers: storedUnlockHeaders(collectionId),
  });
}

/** PUTs the caller's own favorite mark (Owner or Contributor); resolves with the Collection as the caller sees it. */
export async function setCollectionFavorite(
  request: AuthenticatedApiRequest,
  collectionId: number,
  isFavorite: boolean,
): Promise<Collection> {
  const response = await request<Collection>({
    method: 'PUT',
    path: `/api/v1/collections/${collectionId}/favorite`,
    body: { isFavorite },
  });

  if (!response.body) {
    throw new Error('Juple API returned no Collection body.');
  }

  return response.body;
}

/** A picked photo for a Collection's icon (see setCollectionIconImage). */
export interface CollectionIconImageAsset {
  readonly uri: string;
  /** The picker's own reported MIME type - the server checks the real format by magic bytes. */
  readonly type?: string;
  readonly fileName?: string;
}

const ICON_IMAGE_UPLOAD_TIMEOUT_MS = 60_000;

/** Owner only: uses the photo as the Collection's icon (replacing any previous one). Returns the updated Collection. */
export async function setCollectionIconImage(
  request: AuthenticatedApiRequest,
  collectionId: number,
  asset: CollectionIconImageAsset,
): Promise<Collection> {
  const formData = new FormData();
  formData.append('file', { uri: asset.uri, type: asset.type, name: asset.fileName ?? 'icon' });
  const response = await request<Collection>({
    method: 'PUT',
    path: `/api/v1/collections/${collectionId}/icon-image`,
    headers: storedUnlockHeaders(collectionId),
    formData,
    timeoutMs: ICON_IMAGE_UPLOAD_TIMEOUT_MS,
  });

  if (!response.body) {
    throw new Error('Juple API returned no Collection body.');
  }

  return response.body;
}

/** Owner only: back to the built-in icon (idempotent). Returns the updated Collection. */
export async function removeCollectionIconImage(request: AuthenticatedApiRequest, collectionId: number): Promise<Collection> {
  const response = await request<Collection>({
    method: 'DELETE',
    path: `/api/v1/collections/${collectionId}/icon-image`,
    headers: storedUnlockHeaders(collectionId),
  });

  if (!response.body) {
    throw new Error('Juple API returned no Collection body.');
  }

  return response.body;
}

/** PUTs a Collection's icon; resolves with the updated Collection (409 on a concurrent modification). */
export async function setCollectionIcon(
  request: AuthenticatedApiRequest,
  collectionId: number,
  icon: string,
): Promise<Collection> {
  const response = await request<Collection>({
    method: 'PUT',
    path: `/api/v1/collections/${collectionId}/icon`,
    headers: storedUnlockHeaders(collectionId),
    body: { icon },
  });

  if (!response.body) {
    throw new Error('Juple API returned no Collection body.');
  }

  return response.body;
}

/** PUTs a Collection's color; resolves with the updated Collection (409 on a concurrent modification). */
export async function setCollectionColor(
  request: AuthenticatedApiRequest,
  collectionId: number,
  color: string,
): Promise<Collection> {
  const response = await request<Collection>({
    method: 'PUT',
    path: `/api/v1/collections/${collectionId}/color`,
    headers: storedUnlockHeaders(collectionId),
    body: { color },
  });

  if (!response.body) {
    throw new Error('Juple API returned no Collection body.');
  }

  return response.body;
}

/** Soft-deletes a Collection; resolves on 204. Its Items and memberships are retained for restore. */
export async function deleteCollection(
  request: AuthenticatedApiRequest,
  collectionId: number,
): Promise<void> {
  await request<void>({
    method: 'DELETE',
    path: `/api/v1/collections/${collectionId}`,
    headers: storedUnlockHeaders(collectionId),
  });
}

/** Restores a soft-deleted Collection; resolves on 204. */
export async function restoreCollection(
  request: AuthenticatedApiRequest,
  collectionId: number,
): Promise<void> {
  await request<void>({
    method: 'POST',
    path: `/api/v1/collections/${collectionId}/restore`,
  });
}

export interface GetCollectionItemsOptions {
  readonly limit?: number;
  /** Opaque value from a previous CollectionItemsPage.nextCursor; never parsed or modified. */
  readonly cursor?: string;
  /** Short-lived grant from unlockCollection, required while the Collection is locked. */
  readonly unlockToken?: string | null;
  /**
   * The whole Collection by when each link was added - newest ('dateDesc') or oldest ('dateAsc')
   * first. A cursor is only valid with the sort that issued it. Omitted: the server's original
   * manual order.
   */
  readonly sort?: CollectionItemsSort;
  /**
   * One date section's window, exactly as getCollectionItemSections returned it (fromUtc/toUtc) -
   * the page then holds only that section's links, and its cursor only continues inside it. Needs a
   * date sort. Omitted: the whole Collection, unchanged.
   */
  readonly fromUtc?: string;
  readonly toUtc?: string | null;
}

/**
 * One 일자순 section of a Collection (see getCollectionItemSections) - the same shape and meaning as
 * a History section (ItemHistorySection), over when each link was added to this Collection.
 */
export interface CollectionItemSection {
  readonly key: string;
  readonly kind: 'today' | 'yesterday' | 'thisWeek' | 'month';
  readonly year: number | null;
  readonly month: number | null;
  readonly fromUtc: string;
  readonly toUtc: string | null;
  readonly count: number;
}

export type CollectionItemsSort = 'dateDesc' | 'dateAsc';

/** The request header the unlock grant travels in (a header, so it never lands in a URL/log line). */
export const COLLECTION_UNLOCK_HEADER = COLLECTION_UNLOCK_HEADER_NAME;

function unlockHeaders(unlockToken: string | null | undefined): Readonly<Record<string, string>> | undefined {
  return unlockToken ? { [COLLECTION_UNLOCK_HEADER]: unlockToken } : undefined;
}

/** A Collection's Item list (see GetCollectionItemsOptions.sort) - always paginated, a Collection's size is unbounded. */
export async function getCollectionItems(
  request: AuthenticatedApiRequest,
  collectionId: number,
  options: GetCollectionItemsOptions = {},
): Promise<CollectionItemsPage> {
  const query = new URLSearchParams();
  if (options.limit !== undefined) {
    query.set('limit', String(options.limit));
  }
  if (options.cursor) {
    query.set('cursor', options.cursor);
  }
  if (options.sort) {
    query.set('sort', options.sort);
  }
  if (options.fromUtc) {
    query.set('fromUtc', options.fromUtc);
  }
  if (options.toUtc) {
    query.set('toUtc', options.toUtc);
  }
  const queryString = query.toString();

  const response = await request<CollectionItemsPage>({
    method: 'GET',
    path: queryString
      ? `/api/v1/collections/${collectionId}/items?${queryString}`
      : `/api/v1/collections/${collectionId}/items`,
    headers: unlockHeaders(options.unlockToken),
  });

  if (!response.body) {
    throw new Error('Juple API returned no Collection Items page body.');
  }

  return response.body;
}

/**
 * A Collection's 일자순 summary: its non-empty 오늘 / 어제 / 이번 주 / month sections, newest first,
 * with exact link counts and no link data - one small request however large the Collection is. Each
 * section's links come from getCollectionItems with its fromUtc/toUtc. Same lock gate as the list.
 */
export async function getCollectionItemSections(
  request: AuthenticatedApiRequest,
  collectionId: number,
  unlockToken?: string | null,
): Promise<readonly CollectionItemSection[]> {
  const response = await request<{ readonly sections: readonly CollectionItemSection[] }>({
    method: 'GET',
    path: `/api/v1/collections/${collectionId}/items/sections`,
    headers: unlockHeaders(unlockToken),
  });

  if (!response.body) {
    throw new Error('Juple API returned no Collection item sections body.');
  }

  return response.body.sections;
}

/** Read-only view of one link in a Collection (for another member's link - never memo/photos). */
export interface SharedCollectionItem {
  readonly itemId: number;
  readonly url: string;
  readonly title: string | null;
  readonly previewImageUrl: string | null;
  readonly addedAtUtc: string;
  readonly isMine: boolean;
  readonly addedBy?: CollectionItemAdder | null;
}

export async function getSharedCollectionItem(
  request: AuthenticatedApiRequest,
  collectionId: number,
  itemId: number,
  unlockToken?: string | null,
): Promise<SharedCollectionItem> {
  const response = await request<SharedCollectionItem>({
    method: 'GET',
    path: `/api/v1/collections/${collectionId}/items/${itemId}`,
    headers: unlockHeaders(unlockToken),
  });

  if (!response.body) {
    throw new Error('Juple API returned no shared Collection Item body.');
  }

  return response.body;
}

export interface CollectionUnlockGrant {
  readonly unlockToken: string;
  readonly expiresAtUtc: string;
}

/**
 * Verifies a locked Collection's password server-side (throttled) and returns a short-lived grant
 * bound to this user. Rejects with ApiError forbidden/"invalidCollectionPassword" for a wrong
 * password and tooManyRequests after repeated failures. The password is only ever sent here.
 */
export async function unlockCollection(
  request: AuthenticatedApiRequest,
  collectionId: number,
  password: string,
): Promise<CollectionUnlockGrant> {
  const response = await request<CollectionUnlockGrant>({
    method: 'POST',
    path: `/api/v1/collections/${collectionId}/unlock`,
    body: { password },
  });

  if (!response.body) {
    throw new Error('Juple API returned no unlock grant.');
  }

  return response.body;
}

/**
 * Owner only. Locks the Collection under the Owner's one lock password (Settings > 컬렉션 잠금) -
 * no password is sent. Rejects with ApiError conflict/"collectionLockPasswordNotConfigured" when the
 * Owner has not set one yet.
 */
export async function setCollectionLock(request: AuthenticatedApiRequest, collectionId: number): Promise<void> {
  await request<void>({
    method: 'PUT',
    path: `/api/v1/collections/${collectionId}/lock`,
    body: {},
  });
}

/** Owner only. Removes the lock after the Owner's lock password is verified (no bypass for the Owner). */
export async function removeCollectionLock(
  request: AuthenticatedApiRequest,
  collectionId: number,
  currentPassword: string,
): Promise<void> {
  await request<void>({
    method: 'POST',
    path: `/api/v1/collections/${collectionId}/lock/remove`,
    body: { currentPassword },
  });
}

/**
 * How a membership change proves a locked Collection was unlocked. Omitted: the grant of the
 * current Collection visit, if any (see collectionUnlockGrants). Given: exactly this grant (or none
 * for null) - the Collection picker passes the one its own session obtained, never a visit's.
 */
export interface MembershipUnlockOptions {
  readonly unlockToken: string | null;
}

function membershipUnlockHeaders(
  collectionId: number,
  options: MembershipUnlockOptions | undefined,
): Readonly<Record<string, string>> | undefined {
  if (options === undefined) {
    return storedUnlockHeaders(collectionId);
  }
  return options.unlockToken ? { [COLLECTION_UNLOCK_HEADER_NAME]: options.unlockToken } : undefined;
}

/**
 * What adding a link did: 'added' - it is a link of the Collection (204, idempotent); 'submitted' -
 * the caller may only propose links there (승인 후 추가, 202): it waits for the Owner and is not a
 * link of the Collection yet.
 */
export type CollectionLinkAddOutcome = 'added' | 'submitted';

/**
 * PUTs the Item into the Collection. Rejects with ApiError conflict 'linkAlreadyInCollection' /
 * 'linkAlreadyPending' when a proposal's link is already there or already waiting.
 */
export async function addItemToCollection(
  request: AuthenticatedApiRequest,
  collectionId: number,
  itemId: number,
  options?: MembershipUnlockOptions,
): Promise<CollectionLinkAddOutcome> {
  const response = await request<{ readonly submitted?: boolean }>({
    method: 'PUT',
    path: `/api/v1/collections/${collectionId}/items/${itemId}`,
    headers: membershipUnlockHeaders(collectionId, options),
  });
  return response?.status === 202 ? 'submitted' : 'added';
}

/** One link waiting for the Owner's approval (승인 후 추가) - see GET /collections/{id}/submissions. */
export interface CollectionLinkSubmission {
  readonly submissionId: number;
  readonly url: string;
  readonly title: string | null;
  readonly previewImageUrl: string | null;
  readonly submittedAtUtc: string;
  /** Proposed through the public link by someone who is not a member - never named (proposer null). */
  readonly viaPublicShare: boolean;
  readonly proposer: CollectionItemAdder | null;
}

export interface CollectionLinkSubmissionPage {
  readonly items: readonly CollectionLinkSubmission[];
  readonly nextCursor: number | null;
}

/** The Owner's 승인 대기 list, oldest first. */
export async function getCollectionSubmissions(
  request: AuthenticatedApiRequest,
  collectionId: number,
  cursor?: number | null,
): Promise<CollectionLinkSubmissionPage> {
  const response = await request<CollectionLinkSubmissionPage>({
    method: 'GET',
    path: `/api/v1/collections/${collectionId}/submissions${cursor ? `?cursor=${cursor}` : ''}`,
    headers: storedUnlockHeaders(collectionId),
  });
  if (!response.body) {
    throw new Error('Juple API returned no submissions body.');
  }
  return response.body;
}

/** The proposal becomes a link of the Collection. 404 when it is no longer waiting; 409 when it can no longer be added. */
export async function approveCollectionSubmission(request: AuthenticatedApiRequest, collectionId: number, submissionId: number): Promise<void> {
  await request<void>({
    method: 'POST',
    path: `/api/v1/collections/${collectionId}/submissions/${submissionId}/approve`,
    headers: storedUnlockHeaders(collectionId),
  });
}

/** Rejects (deletes) the proposal - nothing is added. Idempotent. */
export async function rejectCollectionSubmission(request: AuthenticatedApiRequest, collectionId: number, submissionId: number): Promise<void> {
  await request<void>({
    method: 'DELETE',
    path: `/api/v1/collections/${collectionId}/submissions/${submissionId}`,
    headers: storedUnlockHeaders(collectionId),
  });
}

/** DELETEs the Item from the Collection; resolves on 204 (idempotent - not-a-member succeeds too). Never deletes the Item itself. */
export async function removeItemFromCollection(
  request: AuthenticatedApiRequest,
  collectionId: number,
  itemId: number,
  options?: MembershipUnlockOptions,
): Promise<void> {
  await request<void>({
    method: 'DELETE',
    path: `/api/v1/collections/${collectionId}/items/${itemId}`,
    headers: membershipUnlockHeaders(collectionId, options),
  });
}

/**
 * PUTs itemId's new position: immediately after afterItemId (null = move to the very front).
 * Resolves on 204. A single atomic move, not a full reordered-list replace - the server derives
 * the new order from just this one anchor (see backend CollectionsController.MoveItemAsync), which
 * is why this never needs the full Item id list even for an unbounded/paginated Collection.
 */
export async function moveCollectionItem(
  request: AuthenticatedApiRequest,
  collectionId: number,
  itemId: number,
  afterItemId: number | null,
): Promise<void> {
  await request<void>({
    method: 'PUT',
    path: `/api/v1/collections/${collectionId}/items/${itemId}/position`,
    body: { afterItemId },
    headers: storedUnlockHeaders(collectionId),
  });
}

/**
 * The most links one 내 컬렉션으로 복사 request may carry - mirrors the backend's
 * CopyCollectionItemsService.MaxItemsPerCopy (a larger request is a 400, never a partial copy).
 */
export const MAX_ITEMS_PER_COPY = 200;

/** copiedCount + skippedCount (already in the destination) + unavailableCount (gone from the source) = the distinct ids sent. */
export interface CopyCollectionItemsResult {
  readonly copiedCount: number;
  readonly skippedCount: number;
  readonly unavailableCount: number;
}

/**
 * 내 컬렉션으로 복사: copies links of a Collection shared with the caller into one of their own (the
 * server re-checks both, and copies only what is shared - never a memo, uploaded image or who added).
 * The source's grant of this visit (its share password, if any) travels with the destination's own
 * grant, if it needed one.
 */
export async function copyCollectionItems(
  request: AuthenticatedApiRequest,
  sourceCollectionId: number,
  itemIds: readonly number[],
  destinationCollectionId: number,
  destinationUnlockToken: string | null = null,
): Promise<CopyCollectionItemsResult> {
  const grants = [getCollectionUnlockToken(sourceCollectionId), destinationUnlockToken].filter(
    (token): token is string => token !== null,
  );
  const response = await request<CopyCollectionItemsResult>({
    method: 'POST',
    path: `/api/v1/collections/${sourceCollectionId}/items/copy`,
    body: { destinationCollectionId, itemIds },
    headers: grants.length > 0 ? { [COLLECTION_UNLOCK_HEADER_NAME]: grants.join(',') } : undefined,
  });
  if (!response.body) {
    throw new Error('Juple API returned no collection copy body.');
  }
  return response.body;
}

/** addedCount + skippedCount (the Item was already there) = the distinct Collections sent. */
export interface AddItemToCollectionsResult {
  readonly addedCount: number;
  readonly skippedCount: number;
}

/**
 * 다른 컬렉션에 복제: puts one of the caller's Items into several of their own Collections in one call
 * (the same membership as the single add - never a copy of the Item). A locked destination's grant
 * travels with that destination (unlockTokens: collectionId → grant); the server checks every
 * destination before writing any of them.
 */
export async function addItemToCollections(
  request: AuthenticatedApiRequest,
  itemId: number,
  collectionIds: readonly number[],
  unlockTokens: Readonly<Record<number, string>> = {},
): Promise<AddItemToCollectionsResult> {
  const response = await request<AddItemToCollectionsResult>({
    method: 'POST',
    path: `/api/v1/items/${itemId}/collections`,
    body: { collectionIds, unlockTokens },
  });
  if (!response.body) {
    throw new Error('Juple API returned no replicate body.');
  }
  return response.body;
}

/** The caller's own 새 링크 알림 setting for one Collection they own or belong to (ON by default). */
export interface CollectionNotificationPreference {
  readonly newItemNotificationsEnabled: boolean;
}

export async function getCollectionNotificationPreference(
  request: AuthenticatedApiRequest,
  collectionId: number,
): Promise<CollectionNotificationPreference> {
  const response = await request<CollectionNotificationPreference>({
    method: 'GET',
    path: `/api/v1/collections/${collectionId}/notification-preference`,
  });
  if (!response.body) {
    throw new Error('Juple API returned no notification preference body.');
  }
  return response.body;
}

export async function setCollectionNotificationPreference(
  request: AuthenticatedApiRequest,
  collectionId: number,
  newItemNotificationsEnabled: boolean,
): Promise<CollectionNotificationPreference> {
  const response = await request<CollectionNotificationPreference>({
    method: 'PUT',
    path: `/api/v1/collections/${collectionId}/notification-preference`,
    body: { newItemNotificationsEnabled },
  });
  if (!response.body) {
    throw new Error('Juple API returned no notification preference body.');
  }
  return response.body;
}

export type TransferCollectionItemResult = { readonly targetMembershipCreated: boolean };

export async function transferCollectionItem(request: AuthenticatedApiRequest, sourceCollectionId: number, itemId: number, targetCollectionId: number, targetUnlockToken: string | null = null): Promise<TransferCollectionItemResult> {
  // The grants this visit already holds, plus the destination's own when it was unlocked in the picker.
  const grants = [storedUnlockHeaders(sourceCollectionId, targetCollectionId)?.[COLLECTION_UNLOCK_HEADER_NAME], targetUnlockToken].filter((token): token is string => !!token);
  const response = await request<TransferCollectionItemResult>({ method: 'POST', path: `/api/v1/collections/${sourceCollectionId}/items/${itemId}/move`, body: { targetCollectionId }, headers: grants.length > 0 ? { [COLLECTION_UNLOCK_HEADER_NAME]: grants.join(',') } : undefined });
  if (!response.body) {
    throw new Error('Juple API returned no collection move body.');
  }
  return response.body;
}

export async function undoTransferCollectionItem(request: AuthenticatedApiRequest, sourceCollectionId: number, itemId: number, targetCollectionId: number, targetMembershipCreated: boolean): Promise<void> {
  await request<void>({ method: 'POST', path: `/api/v1/collections/${sourceCollectionId}/items/${itemId}/move/undo`, body: { targetCollectionId, targetMembershipCreated }, headers: storedUnlockHeaders(sourceCollectionId, targetCollectionId) });
}

/** undoOperationId is null only for the source-equals-target no-op - nothing was merged, so there is nothing to undo (see undoCollectionMerge). */
export type MergeCollectionResult = { readonly undoOperationId: string | null };

export async function mergeCollection(request: AuthenticatedApiRequest, sourceCollectionId: number, targetCollectionId: number): Promise<MergeCollectionResult> {
  const response = await request<MergeCollectionResult>({ method: 'POST', path: `/api/v1/collections/${sourceCollectionId}/merge`, body: { targetCollectionId }, headers: storedUnlockHeaders(sourceCollectionId, targetCollectionId) });
  if (!response.body) {
    throw new Error('Juple API returned no collection merge body.');
  }
  return response.body;
}

/** Reverses a single Merge server-side (restores the source Collection, removes only the Target memberships that merge itself created) - see backend CollectionStore.UndoMergeAsync. */
export async function undoCollectionMerge(request: AuthenticatedApiRequest, undoOperationId: string): Promise<void> {
  await request<void>({ method: 'POST', path: '/api/v1/collections/merge/undo', body: { undoOperationId } });
}

/** A Collection's public share - ShareUrl is the full, ready-to-share HTTPS link (composed server-side; never assembled here from a separately-known base URL). */
export interface CollectionShare {
  readonly publicId: string;
  readonly shareUrl: string;
  readonly createdAtUtc: string;
  /**
   * 'read': anyone with the link views (no sign-in). 'write': additionally, holders SIGNED IN to
   * Juple may add their own links - never anonymously. Absent from an older server = 'read'.
   */
  readonly permission?: PublicSharePermission;
}

export type PublicSharePermission = 'read' | 'submit' | 'write';

interface CollectionShareStatus {
  readonly isShared: boolean;
  readonly share: CollectionShare | null;
}

export interface SharePermissionOptions {
  /**
   * The Owner confirmed it: instead of the 409 publicSharePermissionMismatch refusal, the server
   * raises every member and pending invitation below the new permission's minimum role to that
   * minimum, in the same transaction as the permission change (all or nothing).
   */
  readonly raiseLowerRoles?: boolean;
}

function sharePermissionBody(permission: PublicSharePermission, options: SharePermissionOptions) {
  return options.raiseLowerRoles ? { permission, raiseLowerRoles: true } : { permission };
}

/**
 * Activates this Collection's public share with the given permission; idempotent - resolves with
 * the existing active share (and its permission, unchanged) if one is already enabled.
 */
export async function enableCollectionShare(
  request: AuthenticatedApiRequest,
  collectionId: number,
  permission: PublicSharePermission = 'read',
  options: SharePermissionOptions = {},
): Promise<CollectionShare> {
  const response = await request<CollectionShare>({
    method: 'POST',
    path: `/api/v1/collections/${collectionId}/share`,
    body: sharePermissionBody(permission, options),
    headers: storedUnlockHeaders(collectionId),
  });

  if (!response.body) {
    throw new Error('Juple API returned no Collection share body.');
  }

  return response.body;
}

/** Switches the active public link between 'read' and 'write'. Conflict "publicShareNotActive" without an active link. */
export async function setCollectionSharePermission(
  request: AuthenticatedApiRequest,
  collectionId: number,
  permission: PublicSharePermission,
  options: SharePermissionOptions = {},
): Promise<CollectionShare> {
  const response = await request<CollectionShare>({
    method: 'PUT',
    path: `/api/v1/collections/${collectionId}/share/permission`,
    body: sharePermissionBody(permission, options),
    headers: storedUnlockHeaders(collectionId),
  });

  if (!response.body) {
    throw new Error('Juple API returned no Collection share body.');
  }

  return response.body;
}

/**
 * The active 모든 사용자 link's URL for anyone who may view the Collection (an accepted member too),
 * to pass on with the native share sheet - null while the link is off. Read-only: never the link's
 * settings or its password (those stay in the Owner's getCollectionShare).
 */
export async function getCollectionShareLink(
  request: AuthenticatedApiRequest,
  collectionId: number,
): Promise<string | null> {
  const response = await request<{ readonly isShared: boolean; readonly shareUrl: string | null }>({
    method: 'GET',
    path: `/api/v1/collections/${collectionId}/share/link`,
  });

  return response.body?.isShared && response.body.shareUrl ? response.body.shareUrl : null;
}

/** At most this many people per send - the server's own limit (ShareCollectionLinkService.MaxRecipientsPerShare). */
export const MAX_LINK_SHARE_RECIPIENTS = 20;

export interface CollectionLinkShareResult {
  /** Juple IDs the link was sent to. */
  readonly sent: readonly string[];
  /** Juple IDs that belong to nobody (or are malformed) - nothing was sent to them. */
  readonly notFound: readonly string[];
}

/**
 * 친구에게 / ID로 공유: passes the Collection's public link on to these Juple users as a Juple
 * notification - never an invitation or a membership. The server sends only while the public link
 * is still on: otherwise it rejects with ApiError conflict 'publicLinkInactive' and sends nothing.
 */
export async function sendCollectionShareLink(
  request: AuthenticatedApiRequest,
  collectionId: number,
  jupleIds: readonly string[],
): Promise<CollectionLinkShareResult> {
  const response = await request<CollectionLinkShareResult>({
    method: 'POST',
    path: `/api/v1/collections/${collectionId}/share/link/send`,
    body: { jupleIds },
  });

  if (!response.body) {
    throw new Error('Juple API returned no link share body.');
  }

  return response.body;
}

/** Returns null when the Collection is currently unshared - a valid, common state, not an error. */
export async function getCollectionShare(
  request: AuthenticatedApiRequest,
  collectionId: number,
): Promise<CollectionShare | null> {
  const response = await request<CollectionShareStatus>({
    method: 'GET',
    path: `/api/v1/collections/${collectionId}/share`,
  });

  if (!response.body) {
    throw new Error('Juple API returned no Collection share status body.');
  }

  return response.body.share;
}

/** DELETEs this Collection's active share; resolves on 204 (idempotent - already-unshared succeeds too). The revoked link is never reactivated by a later enableCollectionShare call - re-sharing always mints a new one. */
export async function revokeCollectionShare(
  request: AuthenticatedApiRequest,
  collectionId: number,
): Promise<void> {
  await request<void>({
    method: 'DELETE',
    path: `/api/v1/collections/${collectionId}/share`,
    headers: storedUnlockHeaders(collectionId),
  });
}
