import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY = 'juple.auth.forceFreshAuthenticationAfterDeletion';

/** Only a boolean is persisted; no deleted identity or token is retained here. */
export async function getForceFreshAuthenticationAfterDeletion(): Promise<boolean> {
  return (await AsyncStorage.getItem(KEY)) === 'true';
}

export async function setForceFreshAuthenticationAfterDeletion(value: boolean): Promise<void> {
  await AsyncStorage.setItem(KEY, value ? 'true' : 'false');
}
