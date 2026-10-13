import { ApiHttpError, type AppApi } from './appApi.ts';
import type { AppDictionary } from './appI18n.ts';
import { formatMessage } from './appI18n.ts';
import { COLLECTION_UNLOCK_HEADER } from './collectionUnlock.ts';
import type { CollectionsPage, CollectionSummary } from './collectionsView.ts';

/**
 * Moving and copying links between Collections, and copying a shared Collection into one of my own - the mobile
 * CollectionDetailsScreen actions on the SAME Backend API (nothing new on the server):
 *
 *  - 다른 컬렉션에 복제 (my own link): POST /api/v1/items/{itemId}/collections { collectionIds, unlockTokens } - more memberships of the
 *    one Item, never a copy of it; a Collection it is already in is skipped by the server (addedCount / skippedCount).
 *  - 다른 컬렉션으로 이동 (my own link): between two Collections nobody else is in, the server's one atomic move
 *    (POST /api/v1/collections/{source}/items/{itemId}/move); anything shared composes the two permitted steps - add to the
 *    destination FIRST, then remove from here - so a failure in between leaves the link in both, never in neither.
 *  - 내 컬렉션으로 복사 (another member's link): POST /api/v1/collections/{source}/items/copy { destinationCollectionId, itemIds } - the
 *    server makes MY own new Item of the link's URL, title and automatic preview only (never the memo, photos, who added it,
 *    comments or reactions), skips a URL the destination already has, at most MAX_ITEMS_PER_COPY per call, one transaction each.
 *  - 내 컬렉션으로 복제 (a Collection shared with me): POST /api/v1/collections (a new Collection of mine) and then the same copy, in
 *    chunks of MAX_ITEMS_PER_COPY, of every link I can see there. Nothing else is copied (people, invitations, password, sharing,
 *    comments, reactions), the source is never changed.
 *
 * Destinations are always the caller's OWN Collections (mobile useCollectionDestinationPicker): the server checks the same.
 */

/** Mirrors the server's CopyCollectionItemsService.MaxItemsPerCopy (a larger request is a 400, never a partial copy). */
export const MAX_ITEMS_PER_COPY = 200;
const PAGE_LIMIT = 50;
const WHOLE_PAGE_LIMIT = 100;

export const replicatePath = (itemId: number) => `/api/v1/items/${itemId}/collections`;
export const transferPath = (sourceCollectionId: number, itemId: number) => `/api/v1/collections/${sourceCollectionId}/items/${itemId}/move`;
export const membershipPath = (collectionId: number, itemId: number) => `/api/v1/collections/${collectionId}/items/${itemId}`;
export const copyItemsPath = (sourceCollectionId: number) => `/api/v1/collections/${sourceCollectionId}/items/copy`;
export const CREATE_COLLECTION_PATH = '/api/v1/collections';

export interface CopyResult {
  readonly copiedCount: number;
  readonly skippedCount: number;
  readonly unavailableCount: number;
}

export interface ReplicateResult {
  readonly addedCount: number;
  readonly skippedCount: number;
}

/** Several grants travel together, comma-separated (the server reads each Collection's own) - none: no header at all. */
export function grantHeaders(...tokens: readonly (string | null | undefined)[]): Readonly<Record<string, string>> | undefined {
  const grants = tokens.filter((token): token is string => typeof token === 'string' && token.length > 0);
  return grants.length > 0 ? { [COLLECTION_UNLOCK_HEADER]: [...new Set(grants)].join(',') } : undefined;
}

export function isOwnedCollection(collection: Pick<CollectionSummary, 'accessRole'>): boolean {
  return collection.accessRole === undefined || collection.accessRole === 'owner';
}

/** My own Collections, every page (the destinations of every link action). */
export async function loadOwnedCollections(api: AppApi): Promise<readonly CollectionSummary[]> {
  let all: readonly CollectionSummary[] = [];
  let cursor: string | null = null;
  do {
    const query = new URLSearchParams({ scope: 'owned', limit: String(PAGE_LIMIT) });
    if (cursor) {
      query.set('cursor', cursor);
    }
    const page: CollectionsPage = await api<CollectionsPage>({ path: `/api/v1/collections?${query.toString()}` });
    all = [...all, ...page.items];
    cursor = page.nextCursor;
  } while (cursor);
  return all.filter(isOwnedCollection);
}

/**
 * The server's one atomic move is for two Collections nobody else is in (mobile canTransferAtomically); everything else is add-then-
 * remove. A pending invitation still makes the server refuse the atomic move (409 collaborationActive) - the caller then falls back.
 */
export function moveStrategy(source: Pick<CollectionSummary, 'accessRole' | 'hasCollaborators'>, target: Pick<CollectionSummary, 'accessRole' | 'hasCollaborators'>): 'atomic' | 'addThenRemove' {
  return isOwnedCollection(source) && source.hasCollaborators !== true && isOwnedCollection(target) && target.hasCollaborators !== true ? 'atomic' : 'addThenRemove';
}

export function isCollaborationActive(error: unknown): boolean {
  return error instanceof ApiHttpError && error.status === 409 && error.code === 'collaborationActive';
}

/** Splits ids into the server's per-call limit, in order, without duplicates. */
export function chunkIds(ids: readonly number[], size: number = MAX_ITEMS_PER_COPY): readonly (readonly number[])[] {
  const unique = [...new Set(ids)];
  const chunks: number[][] = [];
  for (let start = 0; start < unique.length; start += size) {
    chunks.push(unique.slice(start, start + size));
  }
  return chunks;
}

export function addCopyResults(a: CopyResult, b: CopyResult): CopyResult {
  return { copiedCount: a.copiedCount + b.copiedCount, skippedCount: a.skippedCount + b.skippedCount, unavailableCount: a.unavailableCount + b.unavailableCount };
}

export const NO_COPY: CopyResult = { copiedCount: 0, skippedCount: 0, unavailableCount: 0 };

/** Mobile formatCopyResultMessage. */
export function copyResultMessage(result: CopyResult, dictionary: AppDictionary): string {
  const total = result.copiedCount + result.skippedCount + result.unavailableCount;
  if (result.copiedCount === total) {
    return formatMessage(dictionary.copyResultAll, { count: result.copiedCount });
  }
  return [
    formatMessage(dictionary.copyResultPartial, { total, count: result.copiedCount }),
    result.skippedCount > 0 ? formatMessage(dictionary.copyResultSkipped, { count: result.skippedCount }) : null,
    result.unavailableCount > 0 ? formatMessage(dictionary.copyResultUnavailable, { count: result.unavailableCount }) : null,
  ]
    .filter((part): part is string => part !== null)
    .join(' ');
}

/** Mobile formatReplicateResultMessage. */
export function replicateResultMessage(result: ReplicateResult, dictionary: AppDictionary): string {
  if (result.addedCount === 0) {
    return dictionary.replicateResultNone;
  }
  if (result.skippedCount === 0) {
    return formatMessage(dictionary.replicateResultAll, { count: result.addedCount });
  }
  return formatMessage(dictionary.replicateResultPartial, { total: result.addedCount + result.skippedCount, added: result.addedCount, skipped: result.skippedCount });
}

/** The new Collection of a copy: its name as typed (trimmed) and the source's glyph and colour - never its photo, lock or sharing. */
export function cloneCollectionBody(source: Pick<CollectionSummary, 'icon' | 'color'>, name: string): { readonly name: string; readonly icon: string; readonly color: string | null } {
  return { name: name.trim(), icon: source.icon, color: source.color };
}

/** Every link of the Collection I can see, newest first, page by page (the same pages its 이름순 reads). */
export async function loadVisibleItemIds(api: AppApi, collectionId: number, headers: Readonly<Record<string, string>> | undefined): Promise<readonly number[]> {
  const ids: number[] = [];
  let cursor: string | null = null;
  do {
    const query = new URLSearchParams({ limit: String(WHOLE_PAGE_LIMIT), sort: 'dateDesc' });
    if (cursor) {
      query.set('cursor', cursor);
    }
    const page: { readonly items: readonly { readonly itemId: number }[]; readonly nextCursor: string | null } = await api({ path: `/api/v1/collections/${collectionId}/items?${query.toString()}`, headers });
    ids.push(...page.items.map(item => item.itemId));
    cursor = page.nextCursor;
  } while (cursor);
  return [...new Set(ids)];
}

export type CloneOutcome =
  | { readonly kind: 'done'; readonly collectionId: number; readonly result: CopyResult; readonly failedChunks: number; readonly totalChunks: number }
  | { readonly kind: 'notCreated'; readonly error: unknown };

/**
 * 내 컬렉션으로 복제: the new Collection first, then the copy in chunks, one after the other. A chunk that fails is counted (its links are
 * named as not copied) and the next one still runs - a partial copy is reported as such, never as complete, and nothing is undone:
 * what was copied stays in the new Collection, the source is never touched.
 */
export async function cloneCollection(
  api: AppApi,
  source: Pick<CollectionSummary, 'id' | 'icon' | 'color'>,
  name: string,
  sourceHeaders: Readonly<Record<string, string>> | undefined,
): Promise<CloneOutcome> {
  let created: { readonly id: number };
  try {
    created = await api<{ readonly id: number }>({ method: 'POST', path: CREATE_COLLECTION_PATH, body: cloneCollectionBody(source, name) });
  } catch (error) {
    return { kind: 'notCreated', error };
  }
  let result = NO_COPY;
  let failedChunks = 0;
  let chunks: readonly (readonly number[])[] = [];
  try {
    chunks = chunkIds(await loadVisibleItemIds(api, source.id, sourceHeaders));
  } catch {
    return { kind: 'done', collectionId: created.id, result, failedChunks: 1, totalChunks: 1 };
  }
  for (const itemIds of chunks) {
    try {
      const copied = await api<CopyResult>({ method: 'POST', path: copyItemsPath(source.id), body: { destinationCollectionId: created.id, itemIds }, headers: sourceHeaders });
      result = addCopyResults(result, copied);
    } catch {
      failedChunks += 1;
    }
  }
  return { kind: 'done', collectionId: created.id, result, failedChunks, totalChunks: chunks.length };
}

// ---- 다른 컬렉션과 병합 (mobile confirmMergeAction; the existing merge API - no new endpoint) ------------------------------------
//
// Three different things, never to be confused:
//  - 다른 컬렉션에 복제 (replicatePath): my link stays here AND joins other Collections - more memberships of one Item.
//  - 내 컬렉션으로 복제 (cloneCollection): someone else's Collection copied into a NEW one of mine as my own links - the source untouched.
//  - 다른 컬렉션과 병합 (mergePath): every link of MY Collection joins another of mine, then this Collection is DELETED (soft: the
//    server keeps it, and the merge's own undo record, for 30 days - then both are purged; the merge can be undone right after).

export const mergePath = (sourceCollectionId: number) => `/api/v1/collections/${sourceCollectionId}/merge`;
export const MERGE_UNDO_PATH = '/api/v1/collections/merge/undo';

/** How long 되돌리기 is offered after a merge - mobile UNDO_TOAST_DURATION_MS. */
export const MERGE_UNDO_WINDOW_MS = 5000;

/**
 * Whether 다른 컬렉션과 병합 is offered for this Collection (mobile: the Owner, no collaborators, its content open). The server
 * decides again: both Collections owned and not deleted, neither with a collaborator or a pending invitation (409
 * collaborationActive), both unlocked (a grant for a locked one).
 */
export function canMergeCollection(collection: Pick<CollectionSummary, 'accessRole' | 'hasCollaborators'>, contentOpen: boolean): boolean {
  return isOwnedCollection(collection) && collection.hasCollaborators !== true && contentOpen;
}

/** A Collection this one may be merged into: mine, not itself, nobody else in it. */
export function isMergeTarget(candidate: Pick<CollectionSummary, 'id' | 'accessRole' | 'hasCollaborators'>, sourceCollectionId: number): boolean {
  return candidate.id !== sourceCollectionId && isOwnedCollection(candidate) && candidate.hasCollaborators !== true;
}

/** The merge's answer: the token of its undo record (null only for a source-equals-target no-op - nothing to undo). */
export interface MergeResult {
  readonly undoOperationId: string | null;
}

/** A merge that can still be undone from the target's page - kept in this page's memory only, for the undo window. */
export interface PendingMergeUndo {
  readonly undoOperationId: string;
  readonly sourceCollectionId: number;
  readonly targetCollectionId: number;
  readonly sourceName: string;
}

let pendingMergeUndo: (PendingMergeUndo & { readonly rememberedAtMs: number }) | null = null;

/** The page hand-off must happen right away (navigating to the target): an older record is never offered on a later visit. */
const MERGE_UNDO_HANDOFF_MS = 15_000;

export function rememberMergeUndo(undo: PendingMergeUndo, nowMs: number = Date.now()): void {
  pendingMergeUndo = { ...undo, rememberedAtMs: nowMs };
}

/** The undo the target's page offers (none for another Collection, or once the hand-off moment has passed). */
export function peekMergeUndo(targetCollectionId: number, nowMs: number = Date.now()): PendingMergeUndo | null {
  if (!pendingMergeUndo || pendingMergeUndo.targetCollectionId !== targetCollectionId || nowMs - pendingMergeUndo.rememberedAtMs > MERGE_UNDO_HANDOFF_MS) {
    return null;
  }
  const { undoOperationId, sourceCollectionId, sourceName } = pendingMergeUndo;
  return { undoOperationId, sourceCollectionId, targetCollectionId, sourceName };
}

/** Offered once: the banner closing (undone, timed out or dismissed) forgets it. */
export function clearMergeUndo(undoOperationId: string): void {
  if (pendingMergeUndo?.undoOperationId === undoOperationId) {
    pendingMergeUndo = null;
  }
}
