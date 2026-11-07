import {
  deleteTargets,
  getLinkSelectionActions,
  moveTargets,
  partitionByAuthor,
  type LinkSelectionScope,
  type SelectedLink,
} from '../linkSelectionPolicy';

const mine = (id: number): SelectedLink => ({ id, isMine: true });
const theirs = (id: number): SelectedLink => ({ id, isMine: false });

function bar(scope: LinkSelectionScope, selected: readonly SelectedLink[], hasMore = true) {
  return getLinkSelectionActions({ scope, selected }, hasMore).bar;
}

describe('link selection actions - who may do what to which links', () => {
  describe('Home / Archive', () => {
    it('offers 컬렉션 변경, 삭제 and 더보기 (no 링크 열기 on the bar)', () => {
      expect(bar('savedLinks', [mine(1)])).toEqual(['changeCollection', 'delete', 'more']);
      expect(bar('savedLinks', [mine(1), mine(2)])).toEqual(['changeCollection', 'delete', 'more']);
    });
  });

  describe('personal Collection', () => {
    it('offers 삭제, 이동, 복사 and 더보기', () => {
      expect(bar('personalCollection', [mine(1), mine(2)])).toEqual(['delete', 'move', 'copy', 'more']);
    });
  });

  describe('a shared Collection I own', () => {
    it('A. only my links: 삭제, 이동, 복사, 더보기', () => {
      expect(bar('ownedSharedCollection', [mine(1), mine(2)])).toEqual(['delete', 'move', 'copy', 'more']);
    });

    it('B. mixed: still 삭제, 이동, 복사, 더보기 - and no 신고 on the bar', () => {
      const actions = getLinkSelectionActions({ scope: 'ownedSharedCollection', selected: [mine(1), theirs(2)] }, true);
      expect(actions.bar).toEqual(['delete', 'move', 'copy', 'more']);
      expect(actions.isMixed).toBe(true);
      // ...but the other people's links can be reported from 더보기.
      expect(actions.reportInMore).toBe(true);
    });

    it("C. only other people's links: 삭제, 복사, 신고, 더보기 - never 이동", () => {
      const actions = getLinkSelectionActions({ scope: 'ownedSharedCollection', selected: [theirs(1), theirs(2)] }, true);
      expect(actions.bar).toEqual(['delete', 'copy', 'report', 'more']);
      expect(actions.bar).not.toContain('move');
      expect(actions.reportInMore).toBe(false);
    });
  });

  describe("a shared Collection someone else owns", () => {
    it('A. only my links: 삭제, 복사, 더보기 (my link can still be moved from 더보기)', () => {
      const actions = getLinkSelectionActions({ scope: 'foreignSharedCollection', selected: [mine(1)] }, true);
      expect(actions.bar).toEqual(['delete', 'copy', 'more']);
      expect(actions.moveInMore).toBe(true);
    });

    it("B. mixed: 복사 and 더보기 only - no 삭제, no 이동", () => {
      const actions = getLinkSelectionActions({ scope: 'foreignSharedCollection', selected: [mine(1), theirs(2)] }, true);
      expect(actions.bar).toEqual(['copy', 'more']);
      expect(actions.reportInMore).toBe(true);
      expect(actions.moveInMore).toBe(false);
    });

    it("C. only other people's links: 복사, 신고, 더보기 - no 삭제", () => {
      expect(bar('foreignSharedCollection', [theirs(1)])).toEqual(['copy', 'report', 'more']);
    });
  });

  it('recomputes on every selection change', () => {
    const first = bar('ownedSharedCollection', [mine(1)]);
    const second = bar('ownedSharedCollection', [mine(1), theirs(2)]);
    const third = bar('ownedSharedCollection', [theirs(2)]);
    expect(first).toContain('move');
    expect(second).toContain('move');
    expect(third).not.toContain('move');
    expect(third).toContain('report');
  });

  it('leaves 더보기 out when there is nothing in it', () => {
    expect(bar('personalCollection', [mine(1)], false)).toEqual(['delete', 'move', 'copy']);
  });
});

describe('what an action may actually touch (never just the visible buttons)', () => {
  it('splits a selection by author', () => {
    const { mine: own, others } = partitionByAuthor([mine(1), theirs(2), mine(3)]);
    expect(own.map(link => link.id)).toEqual([1, 3]);
    expect(others.map(link => link.id)).toEqual([2]);
  });

  it('move only ever applies to my own links, wherever the Collection is', () => {
    expect(moveTargets([mine(1), theirs(2), mine(3)]).map(link => link.id)).toEqual([1, 3]);
    expect(moveTargets([theirs(2)])).toEqual([]);
  });

  it("삭제 in a Collection I own may remove any link; a member may remove only their own", () => {
    const selected = [mine(1), theirs(2)];
    expect(deleteTargets('ownedSharedCollection', selected).map(link => link.id)).toEqual([1, 2]);
    expect(deleteTargets('personalCollection', selected).map(link => link.id)).toEqual([1, 2]);
    expect(deleteTargets('foreignSharedCollection', selected).map(link => link.id)).toEqual([1]);
    expect(deleteTargets('foreignSharedCollection', [theirs(2)])).toEqual([]);
  });
});
