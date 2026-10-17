import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * The six-page tutorial is no longer shown by itself (the on-screen tour is the automatic first run), and nothing writes this record
 * any more. It is still READ: everyone who finished or skipped the old tutorial - any version - already knows the app, so an update
 * must not start the new tour for them. Older versions of the app wrote `juple.tutorial.completed.v<N>.<juple id>` and those keys stay.
 */
export const LEGACY_TUTORIAL_VERSIONS = [1, 2] as const;

/** `userKey` is the public Juple ID (never an email and never the sign-in provider's own id). */
export function tutorialCompletedKey(userKey: string, version: number): string {
  return `juple.tutorial.completed.v${version}.${userKey}`;
}

/**
 * Whether this person ever finished (or skipped) any version of the old tutorial on this device. A storage failure counts as
 * completed: when it cannot be read, no automatic tour is started (the conservative side).
 */
export async function hasCompletedAnyLegacyTutorial(userKey: string): Promise<boolean> {
  try {
    for (const version of LEGACY_TUTORIAL_VERSIONS) {
      if ((await AsyncStorage.getItem(tutorialCompletedKey(userKey, version))) === 'true') {
        return true;
      }
    }
    return false;
  } catch {
    return true;
  }
}
