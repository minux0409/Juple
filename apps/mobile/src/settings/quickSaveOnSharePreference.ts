import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import nativeIncomingShare from '../share/specs/NativeIncomingShare';
import nativeIncomingShareIOS from '../share/specs/NativeIncomingShareIOS';

/**
 * "공유 즉시 저장": when ON, sharing a URL into Juple from another app saves it silently without opening
 * Juple. When OFF (the default: nothing stored yet, a fresh install, or an unreadable value), Juple opens
 * for the user to review the shared URL before saving (see ShareReceiverActivity.kt's native branch on
 * Android). Only an explicit stored 'true' turns it ON; a stored value is never overwritten by an update.
 *
 * Kept platform-agnostic here (plain AsyncStorage, same pattern as languagePreference.ts). The value is
 * mirrored to native code on every change and launch: Android's share receiver, and on iOS the App
 * Group the Juple Share extension reads (ON: it saves the one shared link at once; OFF: it shows its
 * own review with Collections and memo).
 */

const STORAGE_KEY = 'juple.quickSaveOnShare';

async function syncQuickSaveOnShareToNative(enabled: boolean): Promise<void> {
  // iOS: the Juple Share extension reads the same switch from the App Group (see NativeIncomingShareIOS).
  const native = Platform.OS === 'android' ? nativeIncomingShare : Platform.OS === 'ios' ? nativeIncomingShareIOS : null;
  if (!native) {
    return;
  }
  try {
    await native.setQuickSaveOnShare(enabled);
  } catch {
    // Best-effort mirror - a failed native sync just means ShareReceiverActivity falls back to
    // its own default (false, review first) until the next successful sync, never a crash here.
  }
}

/**
 * The effective choice. An explicit stored choice always wins. With none stored, an EXISTING Android installation keeps
 * what the share receiver was already doing (its native SharedPreferences value - historically ON by default and mirrored on
 * every launch), so an update never changes behavior for someone who never touched the switch. A fresh installation has no
 * native state either, and the native default is OFF. Any read failure ends at OFF: a link is never saved silently unless that
 * was chosen. Reading never writes anything.
 */
export async function loadQuickSaveOnSharePreference(): Promise<boolean> {
  try {
    const stored = await AsyncStorage.getItem(STORAGE_KEY);
    if (stored === 'true' || stored === 'false') {
      return stored === 'true';
    }
  } catch {
    // Falls through to the native value / default below.
  }
  if (Platform.OS === 'android' && nativeIncomingShare) {
    try {
      return (await nativeIncomingShare.getQuickSaveOnShare()) === true;
    } catch {
      // Falls through to the default below.
    }
  }
  return false;
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
