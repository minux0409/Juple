import { Linking, Platform } from 'react-native';
import type { PlatformVersionPolicy } from './versionPolicy';

/**
 * The page where THIS platform's store lists the app - nothing here belongs to a Juple account:
 * - Android: the Play Store app itself (market://details?id=<package>), with the https Play page as the fallback (the server's
 *   storeUrl when it configured one). The package id is the installed app's own (passed in), never hardcoded.
 * - iOS: the App Store page from the server's policy. There is deliberately no built-in App Store address (the numeric App Store
 *   id belongs to the real listing and is supplied by configuration); without one, there is nothing to open.
 */
export function storeTargets(platform: string, policy: PlatformVersionPolicy | null, bundleId: string): readonly string[] {
  if (platform === 'android') {
    const encoded = encodeURIComponent(bundleId);
    return [`market://details?id=${encoded}`, policy?.storeUrl ?? `https://play.google.com/store/apps/details?id=${encoded}`];
  }
  if (platform === 'ios') {
    return policy?.storeUrl ? [policy.storeUrl] : [];
  }
  return [];
}

/** Opens the first target the system accepts. Resolves true when one opened, false when none did (the caller says so). */
export async function openStore(policy: PlatformVersionPolicy | null, bundleId: string, platform: string = Platform.OS): Promise<boolean> {
  for (const target of storeTargets(platform, policy, bundleId)) {
    try {
      await Linking.openURL(target);
      return true;
    } catch {
      // Try the next target (the market:// scheme is missing on a device without the Play Store app).
    }
  }
  return false;
}
