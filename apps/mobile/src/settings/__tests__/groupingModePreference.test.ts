import AsyncStorage from '@react-native-async-storage/async-storage';

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(),
  setItem: jest.fn(),
}));

describe('useGroupingModePreference', () => {
  const React = require('react');
  const ReactTestRenderer = require('react-test-renderer');
  const { useGroupingModePreference } = require('../groupingModePreference');

  const mount = async (stored: string | null) => {
    jest.mocked(AsyncStorage.getItem).mockResolvedValue(stored);
    jest.mocked(AsyncStorage.setItem).mockClear();
    jest.mocked(AsyncStorage.setItem).mockResolvedValue(undefined);
    const seen: { current: ReturnType<typeof useGroupingModePreference> | null } = { current: null };
    function Probe() {
      seen.current = useGroupingModePreference('historyGroupingMode');
      return null;
    }
    await ReactTestRenderer.act(async () => {
      ReactTestRenderer.create(React.createElement(Probe));
    });
    return seen;
  };

  it('defaults to 날짜별 (grouped) when nothing is saved, and reads the screen-specific key', async () => {
    const seen = await mount(null);
    expect(seen.current!.groupingMode).toBe('grouped');
    expect(AsyncStorage.getItem).toHaveBeenCalledWith('juple.historyGroupingMode');
  });

  it('restores a saved 전체 (continuous)', async () => {
    const seen = await mount('continuous');
    expect(seen.current!.groupingMode).toBe('continuous');
  });

  it('ignores a value this build does not know', async () => {
    const seen = await mount('calendar');
    expect(seen.current!.groupingMode).toBe('grouped');
  });

  it('persists a change under the same key, separate from the List/Grid key', async () => {
    const seen = await mount(null);
    await ReactTestRenderer.act(async () => {
      seen.current!.changeGroupingMode('continuous');
    });
    expect(seen.current!.groupingMode).toBe('continuous');
    expect(AsyncStorage.setItem).toHaveBeenCalledWith('juple.historyGroupingMode', 'continuous');
    expect(AsyncStorage.setItem).not.toHaveBeenCalledWith('juple.historyViewMode', expect.anything());
  });
});
