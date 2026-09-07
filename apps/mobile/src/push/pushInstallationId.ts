import AsyncStorage from '@react-native-async-storage/async-storage';
// react-native-get-random-values (imported once, at index.js's entry point, before this or
// anything else can call uuid) polyfills crypto.getRandomValues via Android's SecureRandom/iOS's
// SecRandomCopyBytes - confirmed on-device that Hermes does not provide crypto.randomUUID or
// crypto.getRandomValues natively, so uuid would otherwise silently fall back to Math.random(),
// which is not cryptographically secure.
import { v4 as uuidv4 } from 'uuid';

const STORAGE_KEY = 'juple.pushInstallationId';

let cachedInstallationId: string | null = null;

/**
 * A stable per-install identifier - generated once, persisted, and reused for the lifetime of
 * this app install: survives restarts and logout/login/account-switch (see
 * PushDeviceRegistration.ReassignOwner on the Backend, which relies on the same InstallationId
 * arriving again), and is never derived from any hardware/advertising identifier. A fresh
 * uninstall+reinstall legitimately gets a new one, since AsyncStorage does not survive that.
 */
export async function getOrCreatePushInstallationId(): Promise<string> {
  if (cachedInstallationId) {
    return cachedInstallationId;
  }

  const stored = await AsyncStorage.getItem(STORAGE_KEY);
  if (stored) {
    cachedInstallationId = stored;
    return stored;
  }

  const generated = uuidv4();
  await AsyncStorage.setItem(STORAGE_KEY, generated);
  cachedInstallationId = generated;
  return generated;
}
