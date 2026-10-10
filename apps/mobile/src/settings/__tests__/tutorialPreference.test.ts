import AsyncStorage from '@react-native-async-storage/async-storage';
import { CURRENT_TUTORIAL_VERSION, hasCompletedTutorial, markTutorialCompleted, tutorialCompletedKey } from '../tutorialPreference';

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

describe('tutorial preference', () => {
  it('keys completion by tutorial version and by person', () => {
    // v2 is the redesigned six-page first run; raise it only when the first-run mental model changes materially.
    expect(CURRENT_TUTORIAL_VERSION).toBe(2);
    expect(tutorialCompletedKey('JUPLE-1234')).toBe('juple.tutorial.completed.v2.JUPLE-1234');
    expect(tutorialCompletedKey('JUPLE-1234', 1)).toBe('juple.tutorial.completed.v1.JUPLE-1234');
  });

  it('is not completed until marked, then stays completed for that person and version', async () => {
    expect(await hasCompletedTutorial('A')).toBe(false);
    await markTutorialCompleted('A');
    expect(await hasCompletedTutorial('A')).toBe(true);
    expect(AsyncStorage.setItem).toHaveBeenCalledWith('juple.tutorial.completed.v2.A', 'true');
  });

  it('someone who finished the v1 tutorial owes the redesigned v2 once - and the v1 record is left alone', async () => {
    await markTutorialCompleted('A', 1);
    expect(await hasCompletedTutorial('A')).toBe(false);
    expect(await hasCompletedTutorial('A', 1)).toBe(true);
  });

  it('another person on the same device still owes their own tutorial', async () => {
    await markTutorialCompleted('A');
    expect(await hasCompletedTutorial('B')).toBe(false);
  });

  it('a new tutorial version is owed again by someone who finished the old one - without touching the old record', async () => {
    await markTutorialCompleted('A', 1);
    expect(await hasCompletedTutorial('A', 2)).toBe(false);
    expect(await hasCompletedTutorial('A', 1)).toBe(true);
    await markTutorialCompleted('A', 2);
    expect(await hasCompletedTutorial('A', 2)).toBe(true);
  });

  it('never keys by anything but the given key (no email or provider id is read here)', async () => {
    await markTutorialCompleted('JUPLE-9');
    expect([...mockStore.keys()]).toEqual(['juple.tutorial.completed.v2.JUPLE-9']);
  });

  it('a storage failure never traps anyone: reading fails safe to "completed", writing is swallowed', async () => {
    jest.mocked(AsyncStorage.getItem).mockRejectedValueOnce(new Error('disk'));
    expect(await hasCompletedTutorial('A')).toBe(true);
    jest.mocked(AsyncStorage.setItem).mockRejectedValueOnce(new Error('disk'));
    await expect(markTutorialCompleted('A')).resolves.toBeUndefined();
  });
});
