import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * "나중에" on an OPTIONAL update is remembered for a day, per latest build: the person is not asked again on every launch, but a
 * NEWER latest build is a new question and is asked at once. Only the build number and the moment are stored - nothing about the
 * person or the device. A required update has no snooze (it cannot be postponed).
 */
const STORAGE_KEY = 'juple.appUpdate.optionalSnooze';

export const OPTIONAL_UPDATE_SNOOZE_MS = 24 * 60 * 60 * 1000;

export interface OptionalUpdateSnooze {
  readonly latestBuild: number;
  /** Epoch milliseconds of the answer (the device clock - only used to space out a reminder, never for access). */
  readonly dismissedAt: number;
}

export async function loadOptionalUpdateSnooze(): Promise<OptionalUpdateSnooze | null> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return null;
    }
    const value = JSON.parse(raw) as Partial<OptionalUpdateSnooze>;
    return Number.isInteger(value.latestBuild) && typeof value.dismissedAt === 'number' && Number.isFinite(value.dismissedAt)
      ? { latestBuild: value.latestBuild as number, dismissedAt: value.dismissedAt }
      : null;
  } catch {
    return null;
  }
}

/**
 * Writes the answer and resolves only when the storage has accepted it. true: it is persisted. false: it is not - the caller keeps
 * the answer for this session only (the prompt may come back next launch, never more often than that). Never throws and never
 * logs anything but a fixed marker: no build number, no person, no device data.
 */
export async function saveOptionalUpdateSnooze(latestBuild: number, now: number): Promise<boolean> {
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify({ latestBuild, dismissedAt: now } satisfies OptionalUpdateSnooze));
    return true;
  } catch {
    console.warn('[AppUpdate] the "later" answer could not be saved');
    return false;
  }
}

/** Snoozed only for the SAME latest build and only inside the window; a clock that moved backwards never extends it. */
export function isOptionalUpdateSnoozed(snooze: OptionalUpdateSnooze | null, latestBuild: number, now: number): boolean {
  if (snooze === null || snooze.latestBuild !== latestBuild) {
    return false;
  }
  const elapsed = now - snooze.dismissedAt;
  return elapsed >= 0 && elapsed < OPTIONAL_UPDATE_SNOOZE_MS;
}
