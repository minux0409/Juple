package com.juple.app

import android.app.Activity
import android.content.Intent
import android.os.Bundle
import android.util.Log

/**
 * Receives ACTION_SEND from the Android sharesheet, including from a Direct Share category
 * shortcut (see ShortcutSyncManager/res/xml/shortcuts.xml) - the system adds
 * Intent.EXTRA_SHORTCUT_ID to the intent in that case. Never displays any UI itself: it captures
 * the share into PendingShareQueue (resolving EXTRA_SHORTCUT_ID to a category id first, so it is
 * persisted with the pending share from the start), then branches on the "공유 즉시 저장"
 * preference (QuickSaveOnSharePreference, default true/ON):
 * - ON: hands off to IncomingShareSaveScheduler, which schedules the durable retry fallback and
 *   makes a best-effort immediate save via IncomingShareHeadlessService - no UI opens over the
 *   source app, and no title/category is applied (a shortcut-resolved preselectedCollectionId is
 *   intentionally not used here - see incomingShareHeadlessTask.ts). This is the same bare
 *   immediate-save path Quick Save ON used before the since-removed composer UI; that detour
 *   chained extra title/category API calls after the save, which was an added, unnecessary
 *   failure surface (see incomingShareHeadlessTask.ts).
 * - OFF: launches MainActivity so the app's existing pending-share prefill/review UI
 *   (useIncomingShare/DailyInboxScreen) takes over once the user taps Save themselves; any
 *   resolved category is carried along as staged/preselected, applied automatically on save.
 */
class ShareReceiverActivity : Activity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)

    // Diagnostic only (see incomingShareHeadlessTask.ts's own logging) - deliberately limited to
    // the privacy-reviewed allowlist (Intent action/type, boolean extras-presence, boolean
    // capture-success) so this line stays safe to leave enabled in every build, including
    // Production release: never EXTRA_TEXT's actual content, never the pendingShareId value itself
    // (only whether capture succeeded), so a failure can still be traced to "the sharing app didn't
    // provide X" vs. a Juple bug without ever logging what the user actually shared.
    Log.d(
      LogTag,
      "onCreate action=${intent?.action} type=${intent?.type} " +
        "hasSubject=${intent?.hasExtra(Intent.EXTRA_SUBJECT)} " +
        "hasTitle=${intent?.hasExtra(Intent.EXTRA_TITLE)} " +
        "hasShortcutId=${intent?.hasExtra(Intent.EXTRA_SHORTCUT_ID)}",
    )

    val preselectedCollectionId = resolvePreselectedCollectionId()
    val pendingShareId = PendingShareQueue.capture(this, intent, preselectedCollectionId)
    val quickSaveOn = QuickSaveOnSharePreference.isEnabled(this)
    Log.d(LogTag, "captured pendingShare=${pendingShareId != null} quickSaveOn=$quickSaveOn")

    if (pendingShareId != null) {
      if (quickSaveOn) {
        IncomingShareSaveScheduler.schedule(this, pendingShareId)
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

  companion object {
    private const val LogTag = "JupleShare"
  }
}
