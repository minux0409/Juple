import ReactTestRenderer, { act } from 'react-test-renderer';
import { removeItemReaction, setItemReaction } from '../../collections/api/collectionsApi';
import { useItemReactions } from '../useItemReactions';
import { useRecentReactions } from '../recentReactions';

jest.mock('../../collections/api/collectionsApi', () => ({
  setItemReaction: jest.fn(),
  removeItemReaction: jest.fn(),
}));

const mockStorage = new Map<string, string>();
jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(async (key: string) => mockStorage.get(key) ?? null),
    setItem: jest.fn(async (key: string, value: string) => {
      mockStorage.set(key, value);
    }),
  },
}));

type Row = { reactions?: { key: string; count: number }[] | null; myReaction?: string | null };
type Api = ReturnType<typeof useItemReactions>;

function renderHook(onFailure = jest.fn()) {
  const holder: { api?: Api } = {};
  function Harness() {
    holder.api = useItemReactions(jest.fn() as never, 5, () => null, onFailure);
    return null;
  }
  act(() => {
    ReactTestRenderer.create(<Harness />);
  });
  return { holder, onFailure };
}

const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

afterEach(() => {
  jest.clearAllMocks();
  mockStorage.clear();
});

describe('useItemReactions', () => {
  it('add: the counts move at once, then the server\'s answer settles them', async () => {
    const pending = deferred<{ reactions: { key: string; count: number }[]; myReaction: string | null }>();
    jest.mocked(setItemReaction).mockReturnValue(pending.promise);
    const { holder } = renderHook();
    const row: Row = { reactions: [{ key: 'heart', count: 2 }], myReaction: null };

    let done!: Promise<void>;
    act(() => {
      done = holder.api!.react(7, row, 'heart');
    });

    // Before the server has answered: already 3 and mine.
    expect(holder.api!.reactionsOf(7, row)).toEqual({ reactions: [{ key: 'heart', count: 3 }], myReaction: 'heart' });
    expect(setItemReaction).toHaveBeenCalledWith(expect.anything(), 5, 7, 'heart', null);

    await act(async () => {
      pending.resolve({ reactions: [{ key: 'heart', count: 4 }], myReaction: 'heart' });
      await done;
    });
    // The server's own numbers win (someone else reacted meanwhile).
    expect(holder.api!.reactionsOf(7, row)).toEqual({ reactions: [{ key: 'heart', count: 4 }], myReaction: 'heart' });
  });

  it('the same reaction again takes it back with DELETE - never a second PUT', async () => {
    jest.mocked(removeItemReaction).mockResolvedValue({ reactions: [{ key: 'heart', count: 1 }], myReaction: null });
    const { holder } = renderHook();
    const row: Row = { reactions: [{ key: 'heart', count: 2 }], myReaction: 'heart' };

    await act(async () => {
      await holder.api!.react(7, row, 'heart');
    });

    expect(removeItemReaction).toHaveBeenCalledWith(expect.anything(), 5, 7, null);
    expect(setItemReaction).not.toHaveBeenCalled();
    expect(holder.api!.reactionsOf(7, row)).toEqual({ reactions: [{ key: 'heart', count: 1 }], myReaction: null });
  });

  it('another reaction changes it with one PUT: the old count drops and the new one rises', async () => {
    jest.mocked(setItemReaction).mockResolvedValue({ reactions: [{ key: 'heart', count: 2 }, { key: 'fire', count: 1 }], myReaction: 'fire' });
    const { holder } = renderHook();
    const row: Row = { reactions: [{ key: 'heart', count: 3 }], myReaction: 'heart' };

    let done!: Promise<void>;
    act(() => {
      done = holder.api!.react(7, row, 'fire');
    });
    expect(holder.api!.reactionsOf(7, row)).toEqual({ reactions: [{ key: 'heart', count: 2 }, { key: 'fire', count: 1 }], myReaction: 'fire' });
    await act(async () => {
      await done;
    });

    expect(setItemReaction).toHaveBeenCalledTimes(1);
    expect(setItemReaction).toHaveBeenCalledWith(expect.anything(), 5, 7, 'fire', null);
    expect(removeItemReaction).not.toHaveBeenCalled();
  });

  it('a failure puts the previous state back and reports it', async () => {
    jest.mocked(setItemReaction).mockRejectedValue(new Error('offline'));
    const { holder, onFailure } = renderHook();
    const row: Row = { reactions: [{ key: 'heart', count: 2 }], myReaction: null };

    await act(async () => {
      await holder.api!.react(7, row, 'fire');
    });

    expect(holder.api!.reactionsOf(7, row)).toEqual({ reactions: [{ key: 'heart', count: 2 }], myReaction: null });
    expect(onFailure).toHaveBeenCalledTimes(1);
  });

  it('a second tap on the same link while the first is on its way is ignored - counts are never applied twice', async () => {
    const pending = deferred<{ reactions: { key: string; count: number }[]; myReaction: string | null }>();
    jest.mocked(setItemReaction).mockReturnValue(pending.promise);
    const { holder } = renderHook();
    const row: Row = { reactions: [], myReaction: null };

    let first!: Promise<void>;
    act(() => {
      first = holder.api!.react(7, row, 'heart');
      holder.api!.react(7, row, 'heart').catch(() => undefined);
      holder.api!.react(7, row, 'fire').catch(() => undefined);
    });

    expect(setItemReaction).toHaveBeenCalledTimes(1);
    expect(holder.api!.reactionsOf(7, row)).toEqual({ reactions: [{ key: 'heart', count: 1 }], myReaction: 'heart' });
    await act(async () => {
      pending.resolve({ reactions: [{ key: 'heart', count: 1 }], myReaction: 'heart' });
      await first;
    });
    // And once settled, the next tap works again.
    jest.mocked(removeItemReaction).mockResolvedValue({ reactions: [], myReaction: null });
    await act(async () => {
      await holder.api!.react(7, row, 'heart');
    });
    expect(removeItemReaction).toHaveBeenCalledTimes(1);
  });

  it('different links are independent of each other', async () => {
    jest.mocked(setItemReaction).mockImplementation(async (_request, _collection, itemId, key) => ({ reactions: [{ key, count: 1 }], myReaction: key }));
    const { holder } = renderHook();
    const rowA: Row = {};
    const rowB: Row = {};

    await act(async () => {
      await Promise.all([holder.api!.react(1, rowA, 'heart'), holder.api!.react(2, rowB, 'fire')]);
    });

    expect(holder.api!.reactionsOf(1, rowA).myReaction).toBe('heart');
    expect(holder.api!.reactionsOf(2, rowB).myReaction).toBe('fire');
  });

  it('a list that is loaded again (new row objects) shows what the server says, not the old local value', async () => {
    jest.mocked(setItemReaction).mockResolvedValue({ reactions: [{ key: 'heart', count: 1 }], myReaction: 'heart' });
    const { holder } = renderHook();
    const row: Row = { reactions: [], myReaction: null };
    await act(async () => {
      await holder.api!.react(7, row, 'heart');
    });

    const refreshed: Row = { reactions: [{ key: 'heart', count: 5 }], myReaction: null };

    expect(holder.api!.reactionsOf(7, refreshed)).toEqual({ reactions: [{ key: 'heart', count: 5 }], myReaction: null });
  });
});

describe('useRecentReactions', () => {
  it('remembers the picks on this device - newest first, no duplicates, at most six - and reads them back', async () => {
    const holder: { api?: ReturnType<typeof useRecentReactions> } = {};
    function Harness() {
      holder.api = useRecentReactions();
      return null;
    }
    await act(async () => {
      ReactTestRenderer.create(<Harness />);
    });
    expect(holder.api!.recent).toEqual([]);

    for (const key of ['heart', 'fire', 'laugh', 'heart', 'eyes', 'pray', 'party', 'cool']) {
      await act(async () => {
        holder.api!.recordRecent(key);
      });
    }

    expect(holder.api!.recent).toEqual(['cool', 'party', 'pray', 'eyes', 'heart', 'laugh']);
    expect(JSON.parse(mockStorage.get('juple.recentReactions')!)).toEqual(['cool', 'party', 'pray', 'eyes', 'heart', 'laugh']);

    // A new session reads them back (and ignores junk).
    mockStorage.set('juple.recentReactions', JSON.stringify(['fire', 'notAKey', 'fire', 'heart']));
    const second: { api?: ReturnType<typeof useRecentReactions> } = {};
    function Second() {
      second.api = useRecentReactions();
      return null;
    }
    await act(async () => {
      ReactTestRenderer.create(<Second />);
    });
    expect(second.api!.recent).toEqual(['fire', 'heart']);
  });
});
