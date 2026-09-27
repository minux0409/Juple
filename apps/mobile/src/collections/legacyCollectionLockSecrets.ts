import * as Keychain from 'react-native-keychain';

/**
 * Collection lock passwords are no longer stored on the device at all. An earlier Dogfood build
 * could remember them in the Keychain/Keystore (one item per Collection under this service prefix);
 * this only removes any such leftovers. It lists service names and deletes items - it never reads
 * (decrypts) one, so it needs no device authentication. The login session's own Keychain items use
 * different service names and are never touched.
 */
const LEGACY_SERVICE_PREFIX = 'com.juple.app.collection-lock.v1.';

export async function purgeLegacyCollectionLockSecrets(): Promise<void> {
  try {
    const services = await Keychain.getAllGenericPasswordServices();
    await Promise.all(
      services
        .filter(service => service.startsWith(LEGACY_SERVICE_PREFIX))
        .map(service => Keychain.resetGenericPassword({ service }).catch(() => false)),
    );
  } catch {
    // Best effort - retried on the next launch and on sign-out.
  }
}
