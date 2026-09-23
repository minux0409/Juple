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
