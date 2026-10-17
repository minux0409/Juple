import AsyncStorage from '@react-native-async-storage/async-storage';
import { hasCompletedAnyLegacyTutorial, tutorialCompletedKey } from '../tutorialPreference';

const mockStore = new Map<string, string>();
jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(async (key: string) => mockStore.get(key) ?? null),
  setItem: jest.fn(async (key: string, value: string) => {
    mockStore.set(key, value);
  }),
}));

beforeEach(() => {
  mockStore.clear();
  jest.clearAllMocks();
});

describe('legacy tutorial record (read only)', () => {
  it('keeps the keys older app versions wrote', () => {
    expect(tutorialCompletedKey('JUPLE-1234', 2)).toBe('juple.tutorial.completed.v2.JUPLE-1234');
    expect(tutorialCompletedKey('JUPLE-1234', 1)).toBe('juple.tutorial.completed.v1.JUPLE-1234');
  });

  it('is false for someone with no record, true for a v1 OR a v2 record of that person only', async () => {
    expect(await hasCompletedAnyLegacyTutorial('A')).toBe(false);
    mockStore.set('juple.tutorial.completed.v1.A', 'true');
    expect(await hasCompletedAnyLegacyTutorial('A')).toBe(true);
    expect(await hasCompletedAnyLegacyTutorial('B')).toBe(false);
    mockStore.clear();
    mockStore.set('juple.tutorial.completed.v2.A', 'true');
    expect(await hasCompletedAnyLegacyTutorial('A')).toBe(true);
  });

  it('writes nothing, ever', async () => {
    await hasCompletedAnyLegacyTutorial('A');
    expect(AsyncStorage.setItem).not.toHaveBeenCalled();
  });

  it('a storage failure counts as completed, so no automatic tour starts', async () => {
    jest.mocked(AsyncStorage.getItem).mockRejectedValueOnce(new Error('disk'));
    expect(await hasCompletedAnyLegacyTutorial('A')).toBe(true);
  });
});
