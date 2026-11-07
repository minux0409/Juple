import ReactTestRenderer, { act } from 'react-test-renderer';
import { Text } from 'react-native';
import { ApiError } from '../../api/ApiError';
import { runBatch, BULK_CONCURRENCY } from '../runBatch';
import { formatBulkResult } from '../bulkResultMessage';
import { useMultiSelect, type MultiSelect } from '../useMultiSelect';
import { splitBarActions, SELECTION_BAR_SLOT_MIN_WIDTH } from '../SelectionActionBar';
import { selectionBarSignature, type SelectionBarAction } from '../SelectionBarContext';

function Probe({ onValue }: { readonly onValue: (value: MultiSelect<number>) => void }) {
  onValue(useMultiSelect<number>());
  return <Text>probe</Text>;
}

function renderSelect() {
  let current!: MultiSelect<number>;
  act(() => {
    ReactTestRenderer.create(<Probe onValue={value => { current = value; }} />);
  });
  return () => current;
}

describe('useMultiSelect', () => {
  it('starts inactive; a long-press enters selection with that item chosen', () => {
    const select = renderSelect();
    expect(select().isActive).toBe(false);
    act(() => select().enter(5));
    expect(select().isActive).toBe(true);
    expect([...select().selectedIds]).toEqual([5]);
  });

  it('a short tap chooses and un-chooses; un-choosing the LAST one ends selection at once', () => {
    const select = renderSelect();
    act(() => select().enter(1));
    act(() => select().toggle(2));
    expect(select().count).toBe(2);
    act(() => select().toggle(1));
    expect(select().isActive).toBe(true);
    act(() => select().toggle(2));
    expect(select().count).toBe(0);
    expect(select().isActive).toBe(false);
  });

  it('the long-press that starts selection does not end it (one chosen item is never "empty")', () => {
    const select = renderSelect();
    act(() => select().enter(1));
    act(() => select().prune(new Set([1])));
    expect(select().isActive).toBe(true);
  });

  it('a tap while not selecting chooses nothing', () => {
    const select = renderSelect();
    act(() => select().toggle(1));
    expect(select().isActive).toBe(false);
  });

  it('전체 선택 / 전체 해제 / 종료', () => {
    const select = renderSelect();
    act(() => select().enter(1));
    act(() => select().selectAll([1, 2, 3]));
    expect(select().count).toBe(3);
    act(() => select().clear());
    expect(select().count).toBe(0);
    expect(select().isActive).toBe(false);
    act(() => select().enter(1));
    act(() => select().exit());
    expect(select().isActive).toBe(false);
  });

  it('keeps the selection on VALID ids when the list changes (deleted / moved items leave it)', () => {
    const select = renderSelect();
    act(() => select().enter(1));
    act(() => select().selectAll([1, 2, 3]));
    act(() => select().prune(new Set([1, 3, 9])));
    expect([...select().selectedIds].sort()).toEqual([1, 3]);
  });

  it('ends selection when the data change leaves nothing valid chosen (deleted / refreshed away)', () => {
    const select = renderSelect();
    act(() => select().enter(1));
    act(() => select().toggle(2));
    act(() => select().prune(new Set([7])));
    expect(select().isActive).toBe(false);
  });

  it('a list that is only temporarily empty while LOADING never ends selection', () => {
    const select = renderSelect();
    act(() => select().enter(1));
    act(() => select().prune(new Set<number>(), { isLoading: true }));
    expect(select().isActive).toBe(true);
    expect([...select().selectedIds]).toEqual([1]);
    act(() => select().prune(new Set<number>(), { isLoading: false }));
    expect(select().isActive).toBe(false);
  });

  it('an empty selection started from a menu (begin) is not ended by a refresh', () => {
    const select = renderSelect();
    act(() => select().begin());
    act(() => select().prune(new Set<number>()));
    expect(select().isActive).toBe(true);
  });

  it('keeps exactly the failed ids after a partial failure', () => {
    const select = renderSelect();
    act(() => select().enter(1));
    act(() => select().selectAll([1, 2, 3]));
    act(() => select().replace([2]));
    expect([...select().selectedIds]).toEqual([2]);
  });

  it('begin() starts an empty selection', () => {
    const select = renderSelect();
    act(() => select().begin());
    expect(select().isActive).toBe(true);
    expect(select().count).toBe(0);
  });
});

describe('runBatch', () => {
  it('reports every item on its own - a failure never hides the other successes', async () => {
    const outcome = await runBatch([1, 2, 3, 4], async id => {
      if (id % 2 === 0) {
        throw new Error(`no ${id}`);
      }
      return id * 10;
    });
    expect(outcome.succeeded).toEqual([{ id: 1, value: 10 }, { id: 3, value: 30 }]);
    expect(outcome.failed.map(entry => entry.id)).toEqual([2, 4]);
  });

  it('never runs more than the concurrency limit at once', async () => {
    let inFlight = 0;
    let peak = 0;
    await runBatch(Array.from({ length: 12 }, (_, index) => index), async () => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise<void>(resolve => { setTimeout(resolve, 1); });
      inFlight -= 1;
    });
    expect(peak).toBeLessThanOrEqual(BULK_CONCURRENCY);
    expect(peak).toBeGreaterThan(0);
  });
});

describe("runBatch and the server's rate limit", () => {
  it('pauses for a SHORT Retry-After and tries that item once more', async () => {
    const sleep = jest.fn().mockResolvedValue(undefined);
    let calls = 0;
    const outcome = await runBatch([1, 2], async id => {
      calls += 1;
      if (id === 1 && calls === 1) {
        throw new ApiError('tooManyRequests', 429, 'rateLimited', 2);
      }
      return id;
    }, { concurrency: 1, sleep });
    expect(outcome.failed).toEqual([]);
    expect(outcome.succeeded.map(entry => entry.id)).toEqual([1, 2]);
    expect(sleep).toHaveBeenCalled();
  });

  it('does not wait out a LONG limit (like the hourly report limit): that item fails and stays selected', async () => {
    const sleep = jest.fn().mockResolvedValue(undefined);
    const outcome = await runBatch([1], async () => {
      throw new ApiError('tooManyRequests', 429, 'rateLimited', 3600);
    }, { sleep });
    expect(outcome.failed.map(entry => entry.id)).toEqual([1]);
    expect(sleep).not.toHaveBeenCalled();
  });

  it('retries only once - a second refusal is a failure', async () => {
    const sleep = jest.fn().mockResolvedValue(undefined);
    const task = jest.fn().mockRejectedValue(new ApiError('tooManyRequests', 429, 'rateLimited', 1));
    const outcome = await runBatch([1], task, { sleep });
    expect(task).toHaveBeenCalledTimes(2);
    expect(outcome.failed).toHaveLength(1);
  });
});

describe('formatBulkResult - a partial success is never worded as a full one', () => {
  const t = ((key: string, params?: Record<string, unknown>) => `${key}:${JSON.stringify(params ?? {})}`) as never;
  const keys = { allKey: 'all', partialKey: 'partial' };

  it('all went through', () => {
    expect(formatBulkResult(t, { succeeded: 3, failed: 0 }, keys)).toBe('all:{"count":3}');
  });

  it('some failed: says how many of how many and that the failed ones stay selected', () => {
    const text = formatBulkResult(t, { succeeded: 2, failed: 1 }, keys);
    expect(text).toContain('partial:{"ok":2,"total":3}');
    expect(text).toContain('selection.resultFailedKept:{"count":1}');
  });

  it('none went through', () => {
    const text = formatBulkResult(t, { succeeded: 0, failed: 4 }, keys);
    expect(text).toContain('selection.resultNoneSucceeded:{"count":4}');
    expect(text).not.toContain('all:');
  });

  it('mentions items left alone on purpose', () => {
    expect(formatBulkResult(t, { succeeded: 2, failed: 0, skipped: 1 }, keys)).toContain('selection.resultSkipped:{"count":1}');
  });
});

describe('bottom bar layout', () => {
  const icon = () => null;
  const action = (key: string): SelectionBarAction => ({ key, label: key, icon, onPress: jest.fn() });
  const more: SelectionBarAction = { key: 'more', label: 'More', icon, menu: [{ key: 'row', label: 'Row', onPress: jest.fn() }] };

  it('shows every button when they fit', () => {
    const actions = [action('a'), action('b'), action('c'), more];
    const result = splitBarActions(actions, SELECTION_BAR_SLOT_MIN_WIDTH * 4, 'More');
    expect(result.visible.map(entry => entry.key)).toEqual(['a', 'b', 'c', 'more']);
    expect(result.menu).toBeNull();
  });

  it('on a narrow bar the last slot becomes 더보기 and the overflow joins its menu - nothing is squeezed or lost', () => {
    const actions = [action('a'), action('b'), action('c'), action('d'), more];
    const result = splitBarActions(actions, SELECTION_BAR_SLOT_MIN_WIDTH * 3, 'More');
    expect(result.visible.map(entry => entry.key)).toEqual(['a', 'b', 'more']);
    expect(result.menu?.map(row => row.key)).toEqual(['c', 'd', 'row']);
  });

  it('republishes only when what the bar DRAWS changes (handlers are read at press time)', () => {
    const base = { actions: [action('a'), action('b')] };
    const sameLook = { actions: [{ ...action('a'), onPress: jest.fn() }, action('b')] };
    expect(selectionBarSignature(sameLook)).toBe(selectionBarSignature(base));
    const disabled = { actions: [{ ...action('a'), disabled: true }, action('b')] };
    expect(selectionBarSignature(disabled)).not.toBe(selectionBarSignature(base));
    expect(selectionBarSignature(null)).toBe('');
  });
});
