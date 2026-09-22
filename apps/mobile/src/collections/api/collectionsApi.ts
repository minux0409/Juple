import type { AuthenticatedApiRequest } from '../../api/useAuthenticatedApi';
import type { RepresentativeImage } from '../../images/api/imagesApi';

/** A named 보관함 - an Item can belong to any number of Collections at once (unlike Category). */
export interface Collection {
  readonly id: number;
  readonly name: string;
  /** A user preference on the Collection itself (quick-access pinning), not a separate resource. */
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
}

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
  });
}

/** PUTs a Collection's favorite preference; resolves with the updated Collection (409 on a concurrent modification). */
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

/** PUTs a Collection's icon; resolves with the updated Collection (409 on a concurrent modification). */
export async function setCollectionIcon(
  request: AuthenticatedApiRequest,
  collectionId: number,
  icon: string,
): Promise<Collection> {
  const response = await request<Collection>({
    method: 'PUT',
    path: `/api/v1/collections/${collectionId}/icon`,
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
    body: { color },
  });

  if (!response.body) {
    throw new Error('Juple API returned no Collection body.');
  }

  return response.body;
}

/** DELETEs a Collection; resolves on 204. Items inside it are never deleted, only the membership. */
export async function deleteCollection(
  request: AuthenticatedApiRequest,
  collectionId: number,
): Promise<void> {
  await request<void>({
    method: 'DELETE',
    path: `/api/v1/collections/${collectionId}`,
  });
}

export interface GetCollectionItemsOptions {
  readonly limit?: number;
  /** Opaque value from a previous CollectionItemsPage.nextCursor; never parsed or modified. */
  readonly cursor?: string;
}

/** A Collection's Item list, newest-added-first - always paginated, a Collection's size is unbounded. */
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
  const queryString = query.toString();

  const response = await request<CollectionItemsPage>({
    method: 'GET',
    path: queryString
      ? `/api/v1/collections/${collectionId}/items?${queryString}`
      : `/api/v1/collections/${collectionId}/items`,
  });

  if (!response.body) {
    throw new Error('Juple API returned no Collection Items page body.');
  }

  return response.body;
}

/** PUTs the Item into the Collection; resolves on 204 (idempotent - already-a-member succeeds too). */
export async function addItemToCollection(
  request: AuthenticatedApiRequest,
  collectionId: number,
  itemId: number,
): Promise<void> {
  await request<void>({
    method: 'PUT',
    path: `/api/v1/collections/${collectionId}/items/${itemId}`,
  });
}

/** DELETEs the Item from the Collection; resolves on 204 (idempotent - not-a-member succeeds too). Never deletes the Item itself. */
export async function removeItemFromCollection(
  request: AuthenticatedApiRequest,
  collectionId: number,
  itemId: number,
): Promise<void> {
  await request<void>({
    method: 'DELETE',
    path: `/api/v1/collections/${collectionId}/items/${itemId}`,
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
  });
}

export type TransferCollectionItemResult = { readonly targetMembershipCreated: boolean };

export async function transferCollectionItem(request: AuthenticatedApiRequest, sourceCollectionId: number, itemId: number, targetCollectionId: number): Promise<TransferCollectionItemResult> {
  const response = await request<TransferCollectionItemResult>({ method: 'POST', path: `/api/v1/collections/${sourceCollectionId}/items/${itemId}/move`, body: { targetCollectionId } });
  if (!response.body) {
    throw new Error('Juple API returned no collection move body.');
  }
  return response.body;
}

export async function undoTransferCollectionItem(request: AuthenticatedApiRequest, sourceCollectionId: number, itemId: number, targetCollectionId: number, targetMembershipCreated: boolean): Promise<void> {
  await request<void>({ method: 'POST', path: `/api/v1/collections/${sourceCollectionId}/items/${itemId}/move/undo`, body: { targetCollectionId, targetMembershipCreated } });
}

export async function mergeCollection(request: AuthenticatedApiRequest, sourceCollectionId: number, targetCollectionId: number): Promise<void> {
  await request<void>({ method: 'POST', path: `/api/v1/collections/${sourceCollectionId}/merge`, body: { targetCollectionId } });
}

/** A Collection's public share - ShareUrl is the full, ready-to-share HTTPS link (composed server-side; never assembled here from a separately-known base URL). */
export interface CollectionShare {
  readonly publicId: string;
  readonly shareUrl: string;
  readonly createdAtUtc: string;
}

interface CollectionShareStatus {
  readonly isShared: boolean;
  readonly share: CollectionShare | null;
}

/** PUTs to activate this Collection's public share; idempotent - resolves with the existing active share if one is already enabled, rather than minting a new link. */
export async function enableCollectionShare(
  request: AuthenticatedApiRequest,
  collectionId: number,
): Promise<CollectionShare> {
  const response = await request<CollectionShare>({
    method: 'POST',
    path: `/api/v1/collections/${collectionId}/share`,
  });

  if (!response.body) {
    throw new Error('Juple API returned no Collection share body.');
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
  });
}
