import { Platform, Share } from 'react-native';

/**
 * Shares an Item's original URL as-is via the OS Share Sheet - never a Juple-branded link, never
 * rewritten with tracking parameters. Platform.OS branches because React Native's Share API only
 * honors `url` on iOS (Android silently drops it) and only reliably delivers a tappable link via
 * `message` on Android (it becomes Intent.EXTRA_TEXT, which is what target apps parse a URL out
 * of) - `title` maps to Android's Intent.EXTRA_SUBJECT and is otherwise unused, so it's passed on
 * both platforms and simply ignored by apps that don't read it.
 *
 * Resolves normally whether the user actually shared or dismissed the sheet (iOS reports
 * dismissal as a resolved `dismissedAction`, Android has no such signal at all) - only a genuine
 * Share module failure rejects, so callers should treat a caught error as the sole failure case.
 */
export async function shareItem(url: string, title: string | null): Promise<void> {
  const content =
    Platform.OS === 'ios' ? { title: title ?? undefined, url } : { title: title ?? undefined, message: url };

  await Share.share(content);
}
