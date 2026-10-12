import { ApiHttpError, ApiNetworkError, AuthExpiredError, type AppApi } from './appApi.ts';
import type { AppDictionary } from './appI18n.ts';
import { contentGateOf } from './collectionDetails.ts';
import type { CollectionSummary } from './collectionsView.ts';
import { isSharedWithMe } from './collectionSharing.ts';
import { unlockHeadersFor } from './collectionUnlock.ts';

/**
 * Editing one's own link on the Web - the mobile ItemDetailsScreen / itemMemberships.ts rules on the same API, no new endpoint:
 *
 *  - 제목 / 메모: PUT /api/v1/items/{id}/details {title, memo} - a full replacement the SERVER normalizes (title trimmed, whitespace-only
 *    = none, <= 500; memo kept verbatim, <= 4000). Nothing is trimmed or capped here, exactly as on mobile: the server is the judge.
 *  - 사진: ONE photo per link. POST /api/v1/items/{id}/images (multipart "file") stores it, replaces any previous one and makes it
 *    the cover in one step; DELETE /api/v1/items/{id}/images/{imageId} removes it. Immediate - never part of 저장.
 *  - 컬렉션: PUT / DELETE /api/v1/collections/{c}/items/{i}, adds first and then removals, each locked Collection with its own grant.
 *  - 삭제: DELETE /api/v1/items/{id} - the link goes to 삭제 이력 (recoverable); never the permanent endpoint.
 */

export function itemDetailsPath(itemId: number): string {
  return `/api/v1/items/${itemId}/details`;
}

export function itemImageUploadPath(itemId: number): string {
  return `/api/v1/items/${itemId}/images`;
}

export function itemImagePath(itemId: number, imageId: number): string {
  return `/api/v1/items/${itemId}/images/${imageId}`;
}

export function itemEditHref(itemId: number, search = ''): string {
  return `/items/${itemId}/edit${search}`;
}

/**
 * Where a link's pages were reached from, carried in the query so back / forward / refresh keep working: `lockedBy` = the Collection that
 * locks its Home / 보관함 card (reads go IN it, after its password); `collectionId` = opened from inside that Collection (삭제 then
 * means 컬렉션에서 삭제). Never both, never a grant.
 */
export function itemContextSearch(context: { readonly lockedBy: number | null; readonly fromCollectionId: number | null }): string {
  if (context.lockedBy !== null) {
    return `?lockedBy=${context.lockedBy}`;
  }
  return context.fromCollectionId !== null ? `?collectionId=${context.fromCollectionId}` : '';
}

/** The body of the title / memo save: both fields, as typed (mobile updateItemDetails). */
export function itemDetailsBody(title: string, memo: string): { readonly title: string; readonly memo: string } {
  return { title, memo };
}

export function isItemDraftDirty(draft: { readonly title: string; readonly memo: string }, baseline: { readonly title: string; readonly memo: string }): boolean {
  return draft.title !== baseline.title || draft.memo !== baseline.memo;
}

/** The server's own limit (UploadItemImageService.MaxByteLength) - checked here only to avoid sending a file that is certain to be refused. */
export const MAX_ITEM_IMAGE_BYTES = 10 * 1024 * 1024;

/** The formats the server accepts (it re-checks the real bytes): the file picker's filter, never a guarantee. */
export const ITEM_IMAGE_ACCEPT = 'image/jpeg,image/png,image/webp';

/** Whether the picked file can be sent at all: not empty, within the server's size limit. The server still verifies the format. */
export function isUploadableImage(file: Pick<File, 'size'>): boolean {
  return file.size > 0 && file.size <= MAX_ITEM_IMAGE_BYTES;
}

export function imageUploadForm(file: Blob, fileName: string): FormData {
  const form = new FormData();
  form.append('file', file, fileName);
  return form;
}

/** Mobile getSaveErrorMessage (a lost session is handled by the caller, never shown as a message). */
export function itemSaveErrorMessage(error: unknown, dictionary: AppDictionary): string {
  if (error instanceof ApiHttpError && error.status === 400) {
    return dictionary.errorInvalidInput;
  }
  return dictionary.itemSaveError;
}

/** Mobile getImageUploadErrorMessage: never raw server detail. */
export function imageUploadErrorMessage(error: unknown, dictionary: AppDictionary): string {
  if (error instanceof ApiHttpError && error.status === 400) {
    return dictionary.imageUploadInvalid;
  }
  if (error instanceof ApiNetworkError) {
    return dictionary.imageUploadNetwork;
  }
  return dictionary.imageUploadFailed;
}

export function itemDeleteErrorMessage(dictionary: AppDictionary): string {
  return dictionary.itemDeleteFailed;
}

/** Mobile linkProposalErrorMessage: why a proposal (승인 후 추가) was refused, or null when the error is not about that. */
export function linkProposalErrorMessage(error: unknown, dictionary: AppDictionary): string | null {
  if (error instanceof ApiHttpError && error.status === 409) {
    if (error.code === 'linkAlreadyInCollection') {
      return dictionary.linkAlreadyInCollection;
    }
    if (error.code === 'linkAlreadyPending') {
      return dictionary.linkAlreadyPending;
    }
  }
  return null;
}

/** Mobile getCollectionMembershipErrorMessage, plus the two gate sentences of useItemCollectionChange / removeFromContextCollection. */
export function membershipErrorMessage(error: unknown, dictionary: AppDictionary): string {
  const gate = contentGateOf(error);
  if (gate === 'sharePassword') {
    return dictionary.sharePasswordRequiredForAction;
  }
  if (gate === 'lock') {
    return dictionary.lockRequiredForAction;
  }
  return linkProposalErrorMessage(error, dictionary) ?? dictionary.membershipError;
}

/** Mobile isRemovalOwnerOnly: only an Owner takes a link out of a Collection that is shared with me. */
export function isRemovalOwnerOnly(collection: Pick<CollectionSummary, 'accessRole'>): boolean {
  return isSharedWithMe(collection);
}

export interface MembershipChange {
  /** Joined at once (Owner / Contributor). */
  readonly addedIds: readonly number[];
  /** 승인 후 추가: proposals for the Owner - not memberships. */
  readonly proposedIds: readonly number[];
  /** Already there / already waiting: nothing left to save for them. */
  readonly settledIds: readonly number[];
  readonly removedIds: readonly number[];
  /** De-duplicated sentences for everything that did not go through. */
  readonly failureMessages: readonly string[];
}

/**
 * Mobile applyItemMembershipChanges: adds the link to `toAdd`, THEN takes it out of `toRemoveIds` - one request each, in this order,
 * never in parallel. A failure never stops the rest and never undoes what went through (there is no rollback on mobile either):
 * the result says exactly what changed and what did not, and the caller keeps the staged choice for the failed ones.
 */
export async function applyItemMembershipChanges(
  api: AppApi,
  itemId: number,
  toAdd: readonly CollectionSummary[],
  toRemoveIds: readonly number[],
  unlockTokenFor: (collectionId: number) => string | null,
  dictionary: AppDictionary,
): Promise<MembershipChange> {
  const addedIds: number[] = [];
  const proposedIds: number[] = [];
  const settledIds: number[] = [];
  const removedIds: number[] = [];
  const failureMessages: string[] = [];

  for (const collection of toAdd) {
    try {
      const outcome = await api<{ readonly submitted?: boolean } | undefined>({
        method: 'PUT',
        path: `/api/v1/collections/${collection.id}/items/${itemId}`,
        headers: unlockHeadersFor(unlockTokenFor(collection.id)),
      });
      if (outcome?.submitted === true) {
        proposedIds.push(collection.id);
      } else {
        addedIds.push(collection.id);
      }
    } catch (caught) {
      if (isLostSession(caught)) {
        throw caught;
      }
      if (linkProposalErrorMessage(caught, dictionary) !== null) {
        settledIds.push(collection.id);
      }
      failureMessages.push(membershipErrorMessage(caught, dictionary));
    }
  }
  for (const collectionId of toRemoveIds) {
    try {
      await api<void>({
        method: 'DELETE',
        path: `/api/v1/collections/${collectionId}/items/${itemId}`,
        headers: unlockHeadersFor(unlockTokenFor(collectionId)),
      });
      removedIds.push(collectionId);
    } catch (caught) {
      if (isLostSession(caught)) {
        throw caught;
      }
      failureMessages.push(membershipErrorMessage(caught, dictionary));
    }
  }
  return { addedIds, proposedIds, settledIds, removedIds, failureMessages: [...new Set(failureMessages)] };
}

/** A lost session ends the whole save at once (the app signs out) - it is never reported as one Collection failing. */
function isLostSession(error: unknown): boolean {
  return error instanceof AuthExpiredError;
}

/** The set of Collection ids to add and to remove to turn the original membership into the staged one. */
export function membershipDiff(
  original: ReadonlySet<number>,
  selected: readonly CollectionSummary[],
): { readonly toAdd: readonly CollectionSummary[]; readonly toRemoveIds: readonly number[] } {
  const selectedIds = new Set(selected.map(collection => collection.id));
  return {
    toAdd: selected.filter(collection => !original.has(collection.id)),
    toRemoveIds: [...original].filter(id => !selectedIds.has(id)),
  };
}

/** Every Collection the link is in must be representable in the picker, even one the destination list does not offer (a view-only share). */
export function mergeSelectedIntoDestinations(
  destinations: readonly CollectionSummary[],
  memberships: readonly CollectionSummary[],
): readonly CollectionSummary[] {
  const known = new Set(destinations.map(collection => collection.id));
  return [...destinations, ...memberships.filter(collection => !known.has(collection.id))];
}
