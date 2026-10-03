export type FriendSearchEmptyState = 'none' | 'noFriends' | 'noResults';

/**
 * What an empty friend list says - one rule for My Page > Friends and the Share friend picker.
 * A whitespace-only query is no query. Matches -> nothing to explain. A real query with zero matches is always
 * 검색 결과가 없어요 - even when I have no friends at all, never 아직 친구가 없어요 for someone who searched. With no
 * query, an empty list means no friends (totalCount: the friends I have; the list itself when not searching).
 */
export function getFriendSearchEmptyState({ query, totalCount, filteredCount }: {
  readonly query: string;
  readonly totalCount: number;
  readonly filteredCount: number;
}): FriendSearchEmptyState {
  if (filteredCount > 0) {
    return 'none';
  }
  if (query.trim().length > 0) {
    return 'noResults';
  }
  return totalCount === 0 ? 'noFriends' : 'none';
}
