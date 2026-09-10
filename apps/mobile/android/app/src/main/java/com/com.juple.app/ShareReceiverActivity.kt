package com.juple.app

import android.app.Activity
import android.content.Intent
import android.os.Bundle

/**
 * Receives ACTION_SEND from the Android sharesheet, including from a Direct Share category
 * shortcut (see ShortcutSyncManager/res/xml/shortcuts.xml) - the system adds
 * Intent.EXTRA_SHORTCUT_ID to the intent in that case. Never displays any UI itself: it captures
 * the share into PendingShareQueue (resolving EXTRA_SHORTCUT_ID to a category id first, so it is
 * persisted with the pending share from the start), then branches on the "공유 즉시 저장"
 * preference (QuickSaveOnSharePreference, default true/ON):
 * - ON: launches QuickSaveComposerActivity, a small dialog-styled Activity over the source app,
 *   for the user to confirm/edit the title and category before anything is saved - no Item API
 *   call happens here or in the composer until Save is tapped (see
 *   NativeIncomingShareModule.submitQuickSaveDraft).
 * - OFF: launches MainActivity so the app's existing pending-share prefill/review UI
 *   (useIncomingShare/DailyInboxScreen) takes over once the user taps Save themselves; any
 *   resolved category is carried along as staged/preselected, applied automatically on save.
 */
class ShareReceiverActivity : Activity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)

    val preselectedCollectionId = resolvePreselectedCollectionId()
    val pendingShareId = PendingShareQueue.capture(this, intent, preselectedCollectionId)

    if (pendingShareId != null) {
      if (QuickSaveOnSharePreference.isEnabled(this)) {
        startActivity(
          Intent(this, QuickSaveComposerActivity::class.java)
            .putExtra(QuickSaveComposerActivity.ExtraPendingShareId, pendingShareId)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
        )
      } else {
        startActivity(
          Intent(this, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
        )
      }
    }

    finish()
  }

  /**
   * A Direct Share category row's EXTRA_SHORTCUT_ID is set automatically by the system (Sharing
   * Shortcuts API contract) when the user picks it in the Sharesheet - never set by Juple's own
   * Intent. Resolves to null (the generic "no category preselected" composer/review flow) for the
   * plain Juple target, a stale id no longer in the snapshot, or any id this app didn't mint.
   */
  private fun resolvePreselectedCollectionId(): Long? {
    val shortcutId = intent?.getStringExtra(Intent.EXTRA_SHORTCUT_ID) ?: return null
    val categoryId = ShortcutSyncManager.categoryIdFromShortcutId(shortcutId) ?: return null
    val stillExists = CategorySnapshotStore.findById(this, categoryId) != null
    return if (stillExists) categoryId else null
  }
}
