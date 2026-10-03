import { getFriendSearchEmptyState } from '../friendSearchEmptyState';

describe('getFriendSearchEmptyState (My Page > Friends and the Share friend picker)', () => {
  it('no query and no friends -> noFriends', () => {
    expect(getFriendSearchEmptyState({ query: '', totalCount: 0, filteredCount: 0 })).toBe('noFriends');
  });

  it('whitespace-only is no query', () => {
    expect(getFriendSearchEmptyState({ query: '   ', totalCount: 0, filteredCount: 0 })).toBe('noFriends');
  });

  it('a real query with zero matches -> noResults, whether or not I have friends - never noFriends', () => {
    expect(getFriendSearchEmptyState({ query: 'x', totalCount: 12, filteredCount: 0 })).toBe('noResults');
    expect(getFriendSearchEmptyState({ query: ' x ', totalCount: 0, filteredCount: 0 })).toBe('noResults');
  });

  it('matches (or any friends with no query) -> nothing to say', () => {
    expect(getFriendSearchEmptyState({ query: 'x', totalCount: 12, filteredCount: 2 })).toBe('none');
    expect(getFriendSearchEmptyState({ query: '', totalCount: 3, filteredCount: 3 })).toBe('none');
  });
});
