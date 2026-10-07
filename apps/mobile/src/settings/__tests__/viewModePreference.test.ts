import AsyncStorage from '@react-native-async-storage/async-storage';

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(),
  setItem: jest.fn(),
}));

describe('view mode preference storage contract', () => {
  it('uses independent stable keys for each presentation surface', async () => {
    const keys = ['homeViewMode', 'historyViewMode', 'categoryViewMode', 'categoryPickerViewMode'];
    await Promise.all(keys.map(key => AsyncStorage.setItem(`juple.${key}`, 'grid')));
    expect(AsyncStorage.setItem).toHaveBeenCalledTimes(4);
    for (const key of keys) {
      expect(AsyncStorage.setItem).toHaveBeenCalledWith(`juple.${key}`, 'grid');
    }
  });
});

describe('useViewModePreference - the retired calendar view mode', () => {
  const React = require('react');
  const ReactTestRenderer = require('react-test-renderer');
  const { useViewModePreference } = require('../viewModePreference');

  const mountWithStored = async (stored: string | null) => {
    jest.mocked(AsyncStorage.getItem).mockResolvedValue(stored);
    jest.mocked(AsyncStorage.setItem).mockClear();
    jest.mocked(AsyncStorage.setItem).mockResolvedValue(undefined);
    let seen = '';
    function Probe() {
      seen = useViewModePreference('historyViewMode').viewMode;
      return null;
    }
    await ReactTestRenderer.act(async () => {
      ReactTestRenderer.create(React.createElement(Probe));
    });
    return () => seen;
  };

  it('falls back to List for a saved "calendar" and rewrites it so it never comes back', async () => {
    const mode = await mountWithStored('calendar');
    expect(mode()).toBe('list');
    expect(AsyncStorage.setItem).toHaveBeenCalledWith('juple.historyViewMode', 'list');
  });

  it('keeps a saved List / Grid as it is, without writing anything', async () => {
    expect((await mountWithStored('grid'))()).toBe('grid');
    expect(AsyncStorage.setItem).not.toHaveBeenCalled();
    expect((await mountWithStored('list'))()).toBe('list');
    expect(AsyncStorage.setItem).not.toHaveBeenCalled();
  });

  it('stays on List when nothing is saved', async () => {
    expect((await mountWithStored(null))()).toBe('list');
    expect(AsyncStorage.setItem).not.toHaveBeenCalled();
  });
});

describe('useViewModePreference - the Image view', () => {
  const React = require('react');
  const ReactTestRenderer = require('react-test-renderer');
  const { useViewModePreference } = require('../viewModePreference');

  const mount = async (key: string, stored: string | null) => {
    jest.mocked(AsyncStorage.getItem).mockResolvedValue(stored);
    jest.mocked(AsyncStorage.setItem).mockClear();
    jest.mocked(AsyncStorage.setItem).mockResolvedValue(undefined);
    const seen: { current: { viewMode: string; changeViewMode: (mode: string) => void } | null } = { current: null };
    function Probe() {
      seen.current = useViewModePreference(key);
      return null;
    }
    await ReactTestRenderer.act(async () => {
      ReactTestRenderer.create(React.createElement(Probe));
    });
    return seen;
  };

  it('restores a saved Image on Home and the Archive, each under its own key', async () => {
    expect((await mount('homeViewMode', 'image')).current!.viewMode).toBe('image');
    expect(AsyncStorage.getItem).toHaveBeenCalledWith('juple.homeViewMode');
    expect((await mount('historyViewMode', 'image')).current!.viewMode).toBe('image');
    expect(AsyncStorage.getItem).toHaveBeenCalledWith('juple.historyViewMode');
  });

  it('keeps the existing List / Grid values and the List default (nobody is switched to Image)', async () => {
    expect((await mount('homeViewMode', 'grid')).current!.viewMode).toBe('grid');
    expect((await mount('historyViewMode', 'list')).current!.viewMode).toBe('list');
    expect((await mount('homeViewMode', null)).current!.viewMode).toBe('list');
    expect(AsyncStorage.setItem).not.toHaveBeenCalled();
  });

  it('persists a change to Image under the screen\'s own key only', async () => {
    const seen = await mount('historyViewMode', null);
    await ReactTestRenderer.act(async () => {
      seen.current!.changeViewMode('image');
    });
    expect(seen.current!.viewMode).toBe('image');
    expect(AsyncStorage.setItem).toHaveBeenCalledWith('juple.historyViewMode', 'image');
    expect(AsyncStorage.setItem).not.toHaveBeenCalledWith('juple.homeViewMode', expect.anything());
  });

  it('a screen that has no Image view treats a stored image as unknown: List, rewritten', async () => {
    expect((await mount('collectionDetailsViewMode', 'image')).current!.viewMode).toBe('list');
    expect(AsyncStorage.setItem).toHaveBeenCalledWith('juple.collectionDetailsViewMode', 'list');
  });
});
