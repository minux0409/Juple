import AsyncStorage from '@react-native-async-storage/async-storage';
// react-native-get-random-values (imported once, at index.js's entry point, before this or
// anything else can call uuid) polyfills crypto.getRandomValues via Android's SecureRandom/iOS's
// SecRandomCopyBytes - confirmed on-device that Hermes does not provide crypto.randomUUID or
// crypto.getRandomValues natively, so uuid would otherwise silently fall back to Math.random(),
// which is not cryptographically secure.
import { v4 as uuidv4 } from 'uuid';

const STORAGE_KEY = 'juple.pushInstallationId';

let cachedInstallationId: string | null = null;
let pendingInstallationId: Promise<string> | null = null;
// A failed write must not generate a second identity on retry in this process.
let unpersistedInstallationId: string | null = null;

/**
 * A stable per-install identifier - generated once, persisted, and reused for the lifetime of
 * this app install: survives restarts and logout/login/account-switch (see
 * PushDeviceRegistration.ReassignOwner on the Backend, which relies on the same InstallationId
 * arriving again), and is never derived from any hardware/advertising identifier. A fresh
 * uninstall+reinstall legitimately gets a new one, since AsyncStorage does not survive that.
 */
export function getOrCreatePushInstallationId(): Promise<string> {
  if (cachedInstallationId) {
    return Promise.resolve(cachedInstallationId);
  }
  if (pendingInstallationId) return pendingInstallationId;

  pendingInstallationId = loadOrCreateInstallationId().finally(() => {
    pendingInstallationId = null;
  });
  return pendingInstallationId;
}

async function loadOrCreateInstallationId(): Promise<string> {
  // Do not replace an existing installation when storage cannot be read. The caller's
  // best-effort registration can retry once storage recovers, without touching auth.
  const stored = await AsyncStorage.getItem(STORAGE_KEY);
  if (stored) {
    cachedInstallationId = stored;
    unpersistedInstallationId = null;
    return stored;
  }

  const generated = unpersistedInstallationId ?? uuidv4();
  unpersistedInstallationId = generated;
  await AsyncStorage.setItem(STORAGE_KEY, generated);
  cachedInstallationId = generated;
  unpersistedInstallationId = null;
  return generated;
}
