import ReactTestRenderer, { act } from 'react-test-renderer';
import { Text } from 'react-native';
import i18n from '../../i18n';
import { CalendarMonthView } from '../CalendarMonthView';
import { useCalendarBrowse } from '../useCalendarBrowse';
import { currentMonth, shiftMonth } from '../calendarDates';

beforeAll(async () => {
  await i18n.changeLanguage('ko');
});

interface Row {
  readonly id: number;
}

const flush = () => act(async () => { await Promise.resolve(); });

function setup(overrides: { loadMonth?: jest.Mock; loadDay?: jest.Mock; enabled?: boolean } = {}) {
  const loadMonth = overrides.loadMonth ?? jest.fn(async (ref: { year: number; month: number }) => ({ ...ref, days: [{ date: `${ref.year}-${String(ref.month).padStart(2, '0')}-02`, count: 3 }] }));
  const loadDay = overrides.loadDay ?? jest.fn(async () => ({ items: [{ id: 1 }, { id: 2 }] as Row[], nextCursor: 'c1' as string | null }));
  const hook: { current: ReturnType<typeof useCalendarBrowse<Row>> } = {} as never;
  function Harness({ enabled }: { enabled: boolean }) {
    hook.current = useCalendarBrowse<Row>({ enabled, idOf: row => row.id, loadDay, loadMonth });
    return null;
  }
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  act(() => {
    renderer = ReactTestRenderer.create(<Harness enabled={overrides.enabled ?? true} />);
  });
  return { hook, loadMonth, loadDay, renderer, setEnabled: (enabled: boolean) => act(() => renderer.update(<Harness enabled={enabled} />)) };
}

describe('useCalendarBrowse', () => {
  it('loads only the month\'s per-day counts - never any link - until a day is chosen', async () => {
    const { hook, loadMonth, loadDay } = setup();
    await flush();

    expect(loadMonth).toHaveBeenCalledTimes(1);
    expect(loadMonth).toHaveBeenCalledWith(currentMonth());
    expect(loadDay).not.toHaveBeenCalled();
    expect(hook.current.monthStatus).toBe('ready');
    expect([...hook.current.counts.values()]).toEqual([3]);
  });

  it('does nothing while the calendar is not the active view mode', async () => {
    const { loadMonth, setEnabled } = setup({ enabled: false });
    await flush();
    expect(loadMonth).not.toHaveBeenCalled();
    setEnabled(true);
    await flush();
    expect(loadMonth).toHaveBeenCalledTimes(1);
  });

  it('month navigation fetches counts for that month only, caches it, and never pages into the future', async () => {
    const { hook, loadMonth, loadDay } = setup();
    await flush();
    expect(hook.current.canGoNext).toBe(false);

    act(() => hook.current.goToNextMonth());
    await flush();
    expect(hook.current.month).toEqual(currentMonth()); // the future is not reachable

    act(() => hook.current.goToPreviousMonth());
    await flush();
    expect(hook.current.month).toEqual(shiftMonth(currentMonth(), -1));
    expect(loadMonth).toHaveBeenCalledTimes(2);
    expect(hook.current.canGoNext).toBe(true);

    act(() => hook.current.goToNextMonth());
    await flush();
    expect(loadMonth).toHaveBeenCalledTimes(2); // back on a cached month: no second request
    expect(loadDay).not.toHaveBeenCalled(); // and still not a single link was fetched
  });

  it('a chosen day loads its first page; more pages append without duplicates', async () => {
    const loadDay = jest.fn()
      .mockResolvedValueOnce({ items: [{ id: 1 }, { id: 2 }], nextCursor: 'c1' })
      .mockResolvedValueOnce({ items: [{ id: 2 }, { id: 3 }], nextCursor: null });
    const { hook } = setup({ loadDay });
    await flush();

    act(() => hook.current.selectDate('2026-10-02'));
    await flush();
    expect(hook.current.selectedDate).toBe('2026-10-02');
    expect(hook.current.dayItems.map(row => row.id)).toEqual([1, 2]);
    expect(hook.current.hasMoreDay).toBe(true);

    await act(async () => {
      await hook.current.loadMoreDay();
    });
    expect(loadDay).toHaveBeenLastCalledWith('2026-10-02', 'c1');
    expect(hook.current.dayItems.map(row => row.id)).toEqual([1, 2, 3]);
    expect(hook.current.hasMoreDay).toBe(false);
  });

  it('a failed month or day is a retryable error state; a newer day wins over an older response', async () => {
    const loadMonth = jest.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue({ year: 2026, month: 10, days: [] });
    let resolveSlow!: (page: { items: Row[]; nextCursor: null }) => void;
    const loadDay = jest.fn()
      .mockImplementationOnce(() => new Promise(resolve => { resolveSlow = resolve; }))
      .mockResolvedValueOnce({ items: [{ id: 9 }], nextCursor: null });
    const { hook } = setup({ loadMonth, loadDay });
    await flush();
    expect(hook.current.monthStatus).toBe('error');
    await act(async () => {
      await hook.current.retryMonth();
    });
    expect(hook.current.monthStatus).toBe('ready');

    act(() => hook.current.selectDate('2026-10-01'));
    act(() => hook.current.selectDate('2026-10-03'));
    await flush();
    await act(async () => {
      resolveSlow({ items: [{ id: 1 }], nextCursor: null }); // the older request answers last
    });
    expect(hook.current.selectedDate).toBe('2026-10-03');
    expect(hook.current.dayItems.map(row => row.id)).toEqual([9]);
  });

  it('removing a link drops it from the day and lowers (or clears) that day\'s count', async () => {
    const loadMonth = jest.fn(async () => ({ year: 2026, month: 10, days: [{ date: '2026-10-02', count: 2 }] }));
    const { hook } = setup({ loadMonth });
    await flush();
    act(() => hook.current.selectDate('2026-10-02'));
    await flush();

    act(() => hook.current.removeItem(1));
    expect(hook.current.dayItems.map(row => row.id)).toEqual([2]);
    expect(hook.current.counts.get('2026-10-02')).toBe(1);
    act(() => hook.current.removeItem(2));
    expect(hook.current.counts.has('2026-10-02')).toBe(false);
  });
});

describe('CalendarMonthView', () => {
  function renderView(props: Partial<React.ComponentProps<typeof CalendarMonthView>> = {}) {
    const onSelectDate = jest.fn();
    const onRetry = jest.fn();
    let renderer!: ReactTestRenderer.ReactTestRenderer;
    act(() => {
      renderer = ReactTestRenderer.create(
        <CalendarMonthView
          canGoNext
          counts={new Map([['2026-10-02', 3], ['2026-10-05', 120]])}
          month={{ year: 2026, month: 10 }}
          onNextMonth={jest.fn()}
          onPreviousMonth={jest.fn()}
          onRetry={onRetry}
          onSelectDate={onSelectDate}
          selectedDate="2026-10-05"
          status="ready"
          today="2026-10-05"
          {...props}
        />,
      );
    });
    return { renderer, onSelectDate, onRetry };
  }
  const byId = (renderer: ReactTestRenderer.ReactTestRenderer, testID: string) =>
    renderer.root.find(node => node.props.testID === testID && typeof node.props.onPress === 'function');

  it('shows the month, a subtle count only on days that have links (capped at 99+), the selected day and today', () => {
    const { renderer } = renderView();
    expect(renderer.root.find(node => node.props.testID === 'calendar-count-2026-10-02' && node.type === Text).props.children).toBe(3);
    expect(renderer.root.find(node => node.props.testID === 'calendar-count-2026-10-05' && node.type === Text).props.children).toBe('99+');
    expect(renderer.root.findAll(node => node.props.testID === 'calendar-count-2026-10-03')).toHaveLength(0);
    expect(byId(renderer, 'calendar-day-2026-10-05').props.accessibilityState).toEqual({ selected: true });
    expect(byId(renderer, 'calendar-day-2026-10-02').props.accessibilityState).toEqual({ selected: false });
    expect(byId(renderer, 'calendar-day-2026-10-02').props.accessibilityLabel).toContain('링크 3개');
    expect(byId(renderer, 'calendar-day-2026-10-05').props.accessibilityLabel).toContain('오늘');
    // Every day button reaches the minimum touch height.
    expect(JSON.stringify(byId(renderer, 'calendar-day-2026-10-02').props.style)).toContain('"height":50');
  });

  it('tapping a day selects it; the next-month button is disabled at the current month; a failed month offers a retry', () => {
    const { renderer, onSelectDate, onRetry } = renderView({ canGoNext: false });
    act(() => byId(renderer, 'calendar-day-2026-10-09').props.onPress());
    expect(onSelectDate).toHaveBeenCalledWith('2026-10-09');
    expect(renderer.root.find(node => node.props.testID === 'calendar-next' && node.props.accessibilityState).props.accessibilityState).toEqual({ disabled: true });

    const failed = renderView({ status: 'error' });
    act(() => byId(failed.renderer, 'calendar-error-retry').props.onPress());
    expect(failed.onRetry).toHaveBeenCalledTimes(1);
    expect(onRetry).not.toHaveBeenCalled();
  });
});
