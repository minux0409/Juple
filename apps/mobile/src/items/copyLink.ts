import Clipboard from '@react-native-clipboard/clipboard';

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
