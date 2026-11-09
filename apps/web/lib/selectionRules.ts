import { isSharedWithMe } from './collectionSharing.ts';
import { isCollectionLocked, type CollectionSummary } from './collectionsView.ts';
import type { LinkView } from './savedLinks.ts';

/**
 * Who may do what with a multi-selection - the mobile rules (useCollectionSelection / useCollectionLinkSelection), kept pure so they are
 * unit-tested. The server still decides every single request; these only decide what is offered and what the question says.
 */

export type CollectionRole = 'owner' | 'contributor' | 'viewer' | 'submitter';

/**
 * Which of the chosen Collections each bulk action applies to: delete = the person's OWN ones that are open (a locked one needs its
 * password on its own page first - it is skipped, and the question says so); leave = the ones someone else owns. Two separate actions
 * with separate confirmations - never one mixed "delete".
 */
export function planCollectionBulk(selected: readonly CollectionSummary[]) {
  const owned = selected.filter(collection => !isSharedWithMe(collection));
  const deletable = owned.filter(collection => !isCollectionLocked(collection));
  return {
    deletable,
    lockedSkipped: owned.length - deletable.length,
    sharedAmongDeletable: deletable.filter(collection => collection.hasCollaborators === true || collection.isPublicShareActive === true).length,
    leavable: selected.filter(isSharedWithMe),
    /** 즐겨찾기 for all: add when any chosen one is not a favorite yet, otherwise remove from all. */
    favoriteTarget: selected.some(collection => !collection.isFavorite),
  };
}

/**
 * Where a link selection happens (mobile selection/linkSelectionPolicy LinkSelectionScope, the Collection cases): a Collection only I use,
 * a shared Collection I own (members or an active public link), or one another person owns.
 */
export type CollectionLinkScope = 'personalCollection' | 'ownedSharedCollection' | 'foreignSharedCollection';

export function collectionLinkScope(role: CollectionRole, collaborative: boolean): CollectionLinkScope {
  if (role !== 'owner') {
    return 'foreignSharedCollection';
  }
  return collaborative ? 'ownedSharedCollection' : 'personalCollection';
}

/**
 * Whether a chosen link is MINE (I added it): in a personal Collection every link is the Owner's own; in a shared one the adder says so
 * (a link that came in through the public link, or another person's, is not mine). An unknown adder is never assumed to be mine.
 */
export function isMyLink(link: Pick<LinkView, 'adder'>, scope: CollectionLinkScope): boolean {
  if (scope === 'personalCollection') {
    return true;
  }
  return link.adder?.kind === 'person' && link.adder.isMe;
}

export function partitionByAuthor<T extends Pick<LinkView, 'adder'>>(links: readonly T[], scope: CollectionLinkScope): { readonly mine: readonly T[]; readonly others: readonly T[] } {
  return { mine: links.filter(link => isMyLink(link, scope)), others: links.filter(link => !isMyLink(link, scope)) };
}

/** 삭제 (= 이 컬렉션에서 제거): the Owner any link; a member only their own (mobile deleteTargets). */
export function removableLinks<T extends Pick<LinkView, 'adder'>>(links: readonly T[], scope: CollectionLinkScope): readonly T[] {
  return scope === 'foreignSharedCollection' ? links.filter(link => isMyLink(link, scope)) : links;
}

/** 이동: only links I added - never another person's, in whatever Collection (mobile moveTargets). */
export function moveTargets<T extends Pick<LinkView, 'adder'>>(links: readonly T[], scope: CollectionLinkScope): readonly T[] {
  return links.filter(link => isMyLink(link, scope));
}

export type CollectionLinkAction = 'delete' | 'move' | 'copy' | 'report';

/**
 * The actions of a Collection's link selection - the mobile bar and its 더보기 in one list (the Web bar has room for both):
 *
 *  Personal Collection:            삭제, 이동, 복사
 *  Owned shared  - mine only:      삭제, 이동, 복사
 *                - mixed:          삭제, 이동 (mine only), 복사, 신고 (the others' only)
 *                - others only:    삭제, 복사, 신고
 *  Foreign shared - mine only:     삭제, 이동, 복사
 *                 - mixed:         복사, 신고 (the others' only)
 *                 - others only:   복사, 신고
 */
export function collectionLinkActions(scope: CollectionLinkScope, links: readonly Pick<LinkView, 'adder'>[]): readonly CollectionLinkAction[] {
  const { mine, others } = partitionByAuthor(links, scope);
  const hasMine = mine.length > 0;
  const hasOthers = others.length > 0;
  const actions: CollectionLinkAction[] = [];
  switch (scope) {
    case 'personalCollection':
      actions.push('delete', 'move', 'copy');
      break;
    case 'ownedSharedCollection':
      actions.push('delete');
      if (hasMine) actions.push('move');
      actions.push('copy');
      if (hasOthers) actions.push('report');
      break;
    case 'foreignSharedCollection':
      if (hasMine && !hasOthers) actions.push('delete', 'move');
      actions.push('copy');
      if (hasOthers) actions.push('report');
      break;
  }
  return actions;
}

/** 잠금 for several Collections: only those not locked yet (taking a lock off needs the password, never in bulk) - the Owner's lock or a member's own. */
export function lockableCollections(selected: readonly CollectionSummary[]): readonly CollectionSummary[] {
  return selected.filter(collection => !isCollectionLocked(collection));
}

/** Several reports at once (mobile ReportModal bulk): stops at the server's rate limit, everything after it is kept for later. */
export interface BulkReportOutcome<T> {
  readonly received: readonly T[];
  readonly alreadyReported: readonly T[];
  readonly failed: readonly T[];
  readonly rateLimited: boolean;
}

export async function reportEach<T>(targets: readonly T[], send: (target: T) => Promise<{ readonly alreadyReported: boolean }>, isRateLimited: (error: unknown) => boolean): Promise<BulkReportOutcome<T>> {
  const received: T[] = [];
  const alreadyReported: T[] = [];
  const failed: T[] = [];
  let rateLimited = false;
  // One after the other: the rate limit (20 an hour) is a server rule, and a 429 must stop the rest instead of failing them all.
  for (const target of targets) {
    if (rateLimited) {
      failed.push(target);
      continue;
    }
    try {
      const receipt = await send(target);
      (receipt.alreadyReported ? alreadyReported : received).push(target);
    } catch (error) {
      if (isRateLimited(error)) {
        rateLimited = true;
      }
      failed.push(target);
    }
  }
  return { received, alreadyReported, failed, rateLimited };
}

/** A redacted (locked-Collection) card is never selectable - nothing about it may be copied or acted on (mobile isSelectableLink). */
export function isSelectableLink(link: Pick<LinkView, 'locked'>): boolean {
  return !link.locked;
}
