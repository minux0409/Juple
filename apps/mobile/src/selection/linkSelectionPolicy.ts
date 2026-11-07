/**
 * Which bulk actions a link selection offers - the ONE place the rules of the bottom action bar live (Home / Archive, a personal
 * Collection, a shared Collection I own, a shared Collection someone else owns). It decides what is SHOWN and what an action may
 * touch; it is a UI convenience only - the server independently refuses every call the caller may not make, and an action re-checks
 * its own targets right before it runs (see partitionByAuthor).
 */

export type LinkBarActionKey = 'changeCollection' | 'delete' | 'move' | 'copy' | 'report' | 'more';

/** Where the links are selected. */
export type LinkSelectionScope =
  /** Home / Archive: my own saved links, shown without a Collection. */
  | 'savedLinks'
  /** A Collection only I use. */
  | 'personalCollection'
  /** A shared Collection I own (members or an active public link). */
  | 'ownedSharedCollection'
  /** A Collection another person owns and shared with me. */
  | 'foreignSharedCollection';

/** A selected link, reduced to what the rules look at. `isMine`: the saved link is mine (I added it); false = another person's. */
export interface SelectedLink {
  readonly id: number;
  readonly isMine: boolean;
}

export interface LinkSelectionInput {
  readonly scope: LinkSelectionScope;
  readonly selected: readonly SelectedLink[];
}

export interface LinkAuthorPartition {
  readonly mine: readonly SelectedLink[];
  readonly others: readonly SelectedLink[];
}

export function partitionByAuthor(selected: readonly SelectedLink[]): LinkAuthorPartition {
  return { mine: selected.filter(link => link.isMine), others: selected.filter(link => !link.isMine) };
}

/**
 * Which links the person's 삭제 (= 컬렉션에서 제거) really applies to. The Owner of a Collection may remove any link in it; a member
 * only their own. (Home / Archive 삭제 deletes MY saved links, which are always mine.)
 */
export function deleteTargets(scope: LinkSelectionScope, selected: readonly SelectedLink[]): readonly SelectedLink[] {
  if (scope === 'foreignSharedCollection') {
    return selected.filter(link => link.isMine);
  }
  return selected;
}

/** Which links 이동 really applies to: only links I added - never another person's, in whatever Collection. */
export function moveTargets(selected: readonly SelectedLink[]): readonly SelectedLink[] {
  return selected.filter(link => link.isMine);
}

export interface LinkSelectionActions {
  /** The bottom bar's buttons, in order (more last, only when there is something in it). */
  readonly bar: readonly LinkBarActionKey[];
  /** Whether the selection mixes my links with another person's. */
  readonly isMixed: boolean;
  /** 신고 reachable from 더보기 (a mixed selection never gets it on the bar itself). */
  readonly reportInMore: boolean;
  /** 이동 reachable from 더보기 (where the bar itself has no 이동 but my own links can be moved). */
  readonly moveInMore: boolean;
  readonly partition: LinkAuthorPartition;
}

/**
 * The action list for the current selection. Re-run on every selection change.
 *
 *  Home / Archive:                 컬렉션 변경, 삭제, 더보기
 *  Personal Collection:            삭제, 이동, 복사, 더보기
 *  Owned shared  - mine only:      삭제, 이동, 복사, 더보기
 *                - mixed:          삭제, 이동 (mine only), 복사, 더보기
 *                - others only:    삭제, 복사, 신고, 더보기
 *  Foreign shared - mine only:     삭제, 복사, 더보기
 *                 - mixed:         복사, 더보기 (신고 of the others' links only through 더보기)
 *                 - others only:   복사, 신고, 더보기
 *
 * 더보기 is listed only when it has rows: `hasMoreItems` says whether the screen has single-link rows for it, and a mixed report /
 * a foreign Collection's move count too.
 */
export function getLinkSelectionActions(input: LinkSelectionInput, hasMoreItems: boolean): LinkSelectionActions {
  const partition = partitionByAuthor(input.selected);
  const hasMine = partition.mine.length > 0;
  const hasOthers = partition.others.length > 0;
  const isMixed = hasMine && hasOthers;
  const bar: LinkBarActionKey[] = [];
  let reportInMore = false;
  let moveInMore = false;

  switch (input.scope) {
    case 'savedLinks':
      bar.push('changeCollection', 'delete');
      break;
    case 'personalCollection':
      bar.push('delete', 'move', 'copy');
      break;
    case 'ownedSharedCollection':
      bar.push('delete');
      if (hasMine) {
        bar.push('move');
      }
      bar.push('copy');
      if (hasOthers && !hasMine) {
        bar.push('report');
      }
      reportInMore = isMixed;
      break;
    case 'foreignSharedCollection':
      if (hasMine && !hasOthers) {
        bar.push('delete');
      }
      bar.push('copy');
      if (hasOthers && !hasMine) {
        bar.push('report');
      }
      reportInMore = isMixed;
      // The existing "my link into one other Collection of mine" feature stays, behind 더보기.
      moveInMore = hasMine && !hasOthers;
      break;
  }

  if (hasMoreItems || reportInMore || moveInMore) {
    bar.push('more');
  }
  return { bar, isMixed, reportInMore, moveInMore, partition };
}
