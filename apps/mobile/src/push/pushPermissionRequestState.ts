import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_KEY = 'juple.pushPermissionRequested';

/**
 * Whether the app has already shown the OS notification-permission prompt once (see
 * requestPushPermission in pushPermission.ts). PermissionsAndroid.check() cannot distinguish
 * "never asked" from "asked and denied" - both just read as not-granted - so this is the only way
 * to honor "don't re-request an already-decided permission every time" (see
 * RepeatPurchaseEditorScreen, the only call site that ever prompts).
 */
export async function hasRequestedPushPermission(): Promise<boolean> {
  const stored = await AsyncStorage.getItem(STORAGE_KEY);
  return stored === 'true';
}

export async function markPushPermissionRequested(): Promise<void> {
  await AsyncStorage.setItem(STORAGE_KEY, 'true');
}
