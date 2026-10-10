import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * One-time discoverability hints, one per distinct interaction pattern. Completely separate from the tutorial's
 * completion record (`tutorialPreference`): a tutorial version bump never resets a hint and a hint never touches it.
 */
export type HintId = 'savedLinkSwipe' | 'collectionLongPress';

/** Raised only if a hint's meaning changes materially - never for copy edits. */
const HINT_VERSION = 1;

/** `userKey` is the public Juple ID, as for the tutorial: another person on the same device has their own hints. */
export function hintSeenKey(id: HintId, userKey: string): string {
  return `juple.hint.${id}.v${HINT_VERSION}.${userKey}`;
}

/** A storage failure counts as seen: a hint that cannot be remembered must never come back every launch. */
export async function hasSeenHint(id: HintId, userKey: string): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(hintSeenKey(id, userKey))) === 'true';
  } catch {
    return true;
  }
}

export async function markHintSeen(id: HintId, userKey: string): Promise<void> {
  try {
    await AsyncStorage.setItem(hintSeenKey(id, userKey), 'true');
  } catch {
    // Best effort: the worst case is seeing the hint once more.
  }
}
