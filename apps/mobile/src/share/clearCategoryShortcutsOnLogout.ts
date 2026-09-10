import NativeIncomingShare from './specs/NativeIncomingShare';

/**
 * Removes Direct Share category shortcuts and the native category snapshot (see
 * ShortcutSyncManager.kt/CategorySnapshotStore.kt) on sign-out, so a different account signing in
 * on the same device never sees a previous user's categories as Direct Share targets before its
 * own snapshot is first synced. Best-effort, matching pushLogoutUnregister.ts's precedent - never
 * blocks or fails sign-out itself.
 */
export async function clearCategoryShortcutsOnLogoutBestEffort(): Promise<void> {
  if (!NativeIncomingShare) {
    return;
  }

  try {
    await NativeIncomingShare.clearCategoryShortcuts();
  } catch {
    // Best-effort - a leftover shortcut/snapshot is overwritten by the next account's own sync.
  }
}
