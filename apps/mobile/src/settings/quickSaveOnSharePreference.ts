import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import nativeIncomingShare from '../share/specs/NativeIncomingShare';

/**
 * "공유 즉시 저장": when ON (default), sharing a URL into Juple from another app saves it silently
 * without opening Juple - today's/pre-existing behavior. When OFF, Juple opens for the user to
 * review the shared URL before saving (see ShareReceiverActivity.kt's native branch on Android).
 *
 * Kept platform-agnostic here (plain AsyncStorage, same pattern as languagePreference.ts) even
 * though only Android currently implements the OFF-mode native branch - iOS doesn't have a Share
 * Extension yet at all (see README) - so this domain can be reused unchanged once it does.
 */

const STORAGE_KEY = 'juple.quickSaveOnShare';

async function syncQuickSaveOnShareToNative(enabled: boolean): Promise<void> {
  if (Platform.OS !== 'android' || !nativeIncomingShare) {
    return;
  }
  try {
    await nativeIncomingShare.setQuickSaveOnShare(enabled);
  } catch {
    // Best-effort mirror - a failed native sync just means ShareReceiverActivity falls back to
    // its own default (true) until the next successful sync, never a crash here.
  }
}

/** Defaults to true (ON) - a storage read failure must not crash startup or silently disable the pre-existing quick-save behavior. */
export async function loadQuickSaveOnSharePreference(): Promise<boolean> {
  try {
    const stored = await AsyncStorage.getItem(STORAGE_KEY);
    if (stored === 'true' || stored === 'false') {
      return stored === 'true';
    }
  } catch {
    // Falls through to the default below.
  }
  return true;
}

export async function saveQuickSaveOnSharePreference(enabled: boolean): Promise<void> {
  await AsyncStorage.setItem(STORAGE_KEY, enabled ? 'true' : 'false');
  await syncQuickSaveOnShareToNative(enabled);
}

/** Re-syncs the persisted preference to native SharedPreferences. Called once during app bootstrap (see App.tsx) so a value set on a previous run is re-applied even if native prefs were somehow cleared. */
export async function applyStoredQuickSaveOnSharePreference(): Promise<void> {
  const enabled = await loadQuickSaveOnSharePreference();
  await syncQuickSaveOnShareToNative(enabled);
}
