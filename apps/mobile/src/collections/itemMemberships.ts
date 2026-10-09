import type { TFunction } from 'i18next';
import { ApiError } from '../api/ApiError';
import type { AuthenticatedApiRequest } from '../api/useAuthenticatedApi';
import { addItemToCollection, getCollections, removeItemFromCollection, type Collection } from './api/collectionsApi';
import { linkProposalErrorMessage } from './linkProposals';

/**
 * The one place a link's Collection memberships are read and changed from the app, shared by Item Details (staged,
 * saved with 저장) and a link card's long-press 컬렉션 변경 (chosen, then saved). Both go through the same endpoints
 * and the same messages. A link is in any number of Collections; "no Collection" is simply an empty set - the link
 * itself (URL, title, memo, photos, times, owner) is never touched by any of this.
 */

const MEMBERSHIP_PAGE_LIMIT = 50;

export function getItemCollectionsListErrorMessage(error: unknown, t: TFunction): string {
  if (error instanceof ApiError && error.kind === 'unauthorized') {
    return t('errors.unauthorized');
  }
  return t('collections.errorListFallback');
}

export function getCollectionMembershipErrorMessage(error: unknown, t: TFunction): string {
  if (error instanceof ApiError && error.kind === 'unauthorized') {
    return t('errors.unauthorized');
  }
  return linkProposalErrorMessage(error, t) ?? t('collections.errorMembershipFallback');
}

/**
 * Every Collection the link is in - mine AND the ones shared with me it was added to (scope 'all': the default (owned)
 * scope silently left the shared ones out, so a save could never remove the link there). Drains every page.
 */
export async function loadItemMemberships(
  request: AuthenticatedApiRequest,
  itemId: number,
  isStale: () => boolean = () => false,
): Promise<readonly Collection[] | null> {
  let cursor: string | null = null;
  let all: Collection[] = [];
  do {
    const page: Awaited<ReturnType<typeof getCollections>> = await getCollections(request, {
      itemId,
      scope: 'all',
      limit: MEMBERSHIP_PAGE_LIMIT,
      cursor: cursor ?? undefined,
    });
    if (isStale()) {
      return null;
    }
    all = all.concat(page.items);
    cursor = page.nextCursor;
  } while (cursor);
  return all;
}

export interface ApplyMembershipResult {
  /** Joined at once (Owner / Contributor). */
  readonly addedIds: readonly number[];
  /** 승인 후 추가: became proposals for the Owner - not memberships. */
  readonly proposedIds: readonly number[];
  /** Already there / already waiting: nothing left to save for them. */
  readonly settledIds: readonly number[];
  readonly removedIds: readonly number[];
  /** De-duplicated sentences for everything that did not go through. */
  readonly failureMessages: readonly string[];
}

/** Adds the link to `toAdd` then takes it out of `toRemove`, each locked Collection with its own grant. */
export async function applyItemMembershipChanges(
  request: AuthenticatedApiRequest,
  itemId: number,
  toAdd: readonly Collection[],
  toRemoveIds: readonly number[],
  unlockTokenFor: (collectionId: number) => string | null,
  t: TFunction,
): Promise<ApplyMembershipResult> {
  const addedIds: number[] = [];
  const proposedIds: number[] = [];
  const settledIds: number[] = [];
  const removedIds: number[] = [];
  const failureMessages: string[] = [];

  for (const option of toAdd) {
    try {
      const outcome = await addItemToCollection(request, option.id, itemId, { unlockToken: unlockTokenFor(option.id) });
      if (outcome === 'submitted') {
        proposedIds.push(option.id);
      } else {
        addedIds.push(option.id);
      }
    } catch (caughtError) {
      if (linkProposalErrorMessage(caughtError, t) !== null) {
        settledIds.push(option.id);
      }
      failureMessages.push(getCollectionMembershipErrorMessage(caughtError, t));
    }
  }
  for (const collectionId of toRemoveIds) {
    try {
      await removeItemFromCollection(request, collectionId, itemId, { unlockToken: unlockTokenFor(collectionId) });
      removedIds.push(collectionId);
    } catch (caughtError) {
      failureMessages.push(getCollectionMembershipErrorMessage(caughtError, t));
    }
  }
  return { addedIds, proposedIds, settledIds, removedIds, failureMessages: [...new Set(failureMessages)] };
}

/**
 * Only a Collection's Owner may take a link out of it (a server rule): a link already in a Collection shared with me
 * cannot be deselected - it would only fail on save.
 */
export function isRemovalOwnerOnly(option: Pick<Collection, 'accessRole'>): boolean {
  return option.accessRole != null && option.accessRole !== 'owner';
}

/**
 * "컬렉션 없음": deselects every Collection the link is staged in, one after another through the picker's own
 * per-Collection check (a locked one asks for its password; cancelling that stops here, leaving the rest as they
 * were). Collections the link is already in and only a different Owner may remove it from stay selected -
 * `onOwnerOnlyBlocked` says so once.
 */
export function clearItemCollectionSelection(
  selected: readonly Collection[],
  originalIds: ReadonlySet<number>,
  requestToggle: (collection: Collection, toggle: () => void) => void,
  stageRemove: (collectionId: number) => void,
  onOwnerOnlyBlocked: () => void,
): void {
  const removable = selected.filter(option => !(originalIds.has(option.id) && isRemovalOwnerOnly(option)));
  if (removable.length < selected.length) {
    onOwnerOnlyBlocked();
  }
  const queue = [...removable];
  const next = () => {
    const current = queue.shift();
    if (!current) {
      return;
    }
    requestToggle(current, () => {
      stageRemove(current.id);
      next();
    });
  };
  next();
}
