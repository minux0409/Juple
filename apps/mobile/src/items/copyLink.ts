import Clipboard from '@react-native-clipboard/clipboard';
import { Platform } from 'react-native';

/**
 * Android 13 (API 33) and newer confirm every clipboard write themselves (the system's own "copied" bubble); showing a toast of ours as
 * well would say it twice and the two would overlap. Judged by the real OS API level. Android 12 and older, and iOS, show nothing of
 * their own, so the app's own confirmation is kept there. (A failure is always reported by the app - the system says nothing then.)
 */
export function systemAnnouncesCopy(): boolean {
  return Platform.OS === 'android' && Number(Platform.Version) >= 33;
}

/**
 * Puts a saved link's ORIGINAL url (exactly what the person saved - never a Juple share link) on the clipboard.
 * Returns whether it worked; a clipboard that cannot be written is reported by the caller's own feedback.
 */
export function copySavedLinkUrl(url: string): boolean {
  try {
    Clipboard.setString(url);
    return true;
  } catch {
    return false;
  }
}
