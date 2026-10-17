import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * Guided tours are remembered on this device only (never sent to the account), per person and per guide version. Raising a guide's
 * version shows it once more to people who have not seen that version; Help can always start any guide, finished or not.
 */
export function tourCompletedKey(guideId: string, version: number, userKey: string): string {
  return `juple.tour.completed.${guideId}.v${version}.${userKey}`;
}

/** A storage failure counts as completed: failing to read must never bring an automatic tour back on every launch. */
export async function hasCompletedTour(guideId: string, version: number, userKey: string): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(tourCompletedKey(guideId, version, userKey))) === 'true';
  } catch {
    return true;
  }
}

export async function markTourCompleted(guideId: string, version: number, userKey: string): Promise<void> {
  try {
    await AsyncStorage.setItem(tourCompletedKey(guideId, version, userKey), 'true');
  } catch {
    // Best effort: the worst case is seeing the tour once more.
  }
}
