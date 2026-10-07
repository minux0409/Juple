import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * The tutorial's content version. Completion is remembered PER VERSION and per person, so raising this number
 * later shows the new tutorial once to everyone, without disturbing what the old one recorded.
 */
export const CURRENT_TUTORIAL_VERSION = 1;

/**
 * `userKey` identifies the signed-in person on this device. It is the public Juple ID (never an email and never
 * the sign-in provider's own id); the internal user id is not available to the app today. Another person signing
 * in on the same device has their own key and so their own tutorial.
 */
export function tutorialCompletedKey(userKey: string, version: number = CURRENT_TUTORIAL_VERSION): string {
  return `juple.tutorial.completed.v${version}.${userKey}`;
}

/**
 * Whether this person already finished (or skipped) this tutorial version here. A storage failure counts as
 * completed: failing to read must never trap anyone in a tutorial that comes back every launch.
 */
export async function hasCompletedTutorial(userKey: string, version: number = CURRENT_TUTORIAL_VERSION): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(tutorialCompletedKey(userKey, version))) === 'true';
  } catch {
    return true;
  }
}

export async function markTutorialCompleted(userKey: string, version: number = CURRENT_TUTORIAL_VERSION): Promise<void> {
  try {
    await AsyncStorage.setItem(tutorialCompletedKey(userKey, version), 'true');
  } catch {
    // Best effort: the worst case is seeing the tutorial once more.
  }
}
