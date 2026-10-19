import { collectionShortcutService } from '../shortcuts/CollectionShortcutService';
import { iosCollectionShortcuts } from '../shortcuts/iosCollectionShortcuts';

/**
 * Removes the Collection shortcuts (launcher + Direct Share) and their stored set on sign-out, so a different account
 * signing in on the same device never sees a previous user's Collection names in the launcher or the share sheet.
 * Best-effort, matching pushLogoutUnregister.ts's precedent - never blocks or fails sign-out itself.
 */
export async function clearCollectionShortcutsOnLogoutBestEffort(): Promise<void> {
  try {
    await collectionShortcutService.clear();
  } catch {
    // Best-effort - a leftover shortcut is replaced by the next account's own reconcile (which drops any Collection it cannot reach).
  }
  try {
    // iOS: the Collections offered to the Shortcuts app and any pending "컬렉션 열기" launch.
    await iosCollectionShortcuts.clear();
  } catch {
    // Best-effort, as above. A shortcut run later still only opens what the next account can reach (CollectionShortcutRouter).
  }
}
