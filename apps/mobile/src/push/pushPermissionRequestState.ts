import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_KEY = 'juple.pushPermissionRequested';

/** Installation-wide OS request marker. Never cleared by logout; not an OS grant. */
export async function hasRequestedPushPermission(): Promise<boolean> {
  const stored = await AsyncStorage.getItem(STORAGE_KEY);
  return stored === 'true';
}

export async function markPushPermissionRequested(): Promise<void> {
  await AsyncStorage.setItem(STORAGE_KEY, 'true');
}
