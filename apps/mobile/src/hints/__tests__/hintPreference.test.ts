import AsyncStorage from '@react-native-async-storage/async-storage';
import { tutorialCompletedKey } from '../../settings/tutorialPreference';
import { hasSeenHint, hintSeenKey, markHintSeen } from '../hintPreference';

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

describe('hint preference', () => {
  it('keys each hint by its own id and by person, apart from the tutorial record', () => {
    expect(hintSeenKey('savedLinkSwipe', 'JUPLE-1')).toBe('juple.hint.savedLinkSwipe.v1.JUPLE-1');
    expect(hintSeenKey('collectionLongPress', 'JUPLE-1')).toBe('juple.hint.collectionLongPress.v1.JUPLE-1');
    expect(hintSeenKey('savedLinkSwipe', 'JUPLE-1')).not.toBe(hintSeenKey('collectionLongPress', 'JUPLE-1'));
    expect(hintSeenKey('savedLinkSwipe', 'JUPLE-1')).not.toBe(tutorialCompletedKey('JUPLE-1'));
  });

  it('is unseen until marked, then stays seen for that person only', async () => {
    expect(await hasSeenHint('savedLinkSwipe', 'A')).toBe(false);
    await markHintSeen('savedLinkSwipe', 'A');
    expect(await hasSeenHint('savedLinkSwipe', 'A')).toBe(true);
    expect(await hasSeenHint('savedLinkSwipe', 'B')).toBe(false);
    expect(await hasSeenHint('collectionLongPress', 'A')).toBe(false);
  });

  it('a read failure counts as seen and a write failure is swallowed', async () => {
    jest.mocked(AsyncStorage.getItem).mockRejectedValueOnce(new Error('disk'));
    expect(await hasSeenHint('savedLinkSwipe', 'A')).toBe(true);
    jest.mocked(AsyncStorage.setItem).mockRejectedValueOnce(new Error('disk'));
    await expect(markHintSeen('savedLinkSwipe', 'A')).resolves.toBeUndefined();
  });

  it('never touches the tutorial completion record', async () => {
    await markHintSeen('savedLinkSwipe', 'A');
    await markHintSeen('collectionLongPress', 'A');
    expect([...mockStore.keys()].some(key => key.startsWith('juple.tutorial.'))).toBe(false);
  });
});
