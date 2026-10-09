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
 *   source app. A shortcut-resolved preselectedCollectionId is only a CLAIM here: the headless task
 *   re-reads that Collection from the backend (access, role, lock) before saving into it, and falls
 *   back to the review screen - never to some other Collection - when it is no longer usable (see
 *   incomingShareHeadlessTask.ts).
 * - OFF: launches MainActivity so the app's existing pending-share prefill/review UI
 *   (useIncomingShare/DailyInboxScreen) takes over once the user taps Save themselves; any
 *   resolved Collection is carried along as preselected (re-validated by IncomingShareRouter first).
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

    val target = resolveDirectShareTarget()
    val preselectedCollectionId = (target as? DirectShareTarget.Pinned)?.collectionId
    // A Direct Share row whose Collection is no longer one the user pinned: the shared link is NOT saved on the user's
    // behalf (not into some other Collection, not silently into none) - it goes to the review screen with a notice.
    val isStaleTarget = target is DirectShareTarget.Stale
    val quickSaveOn = QuickSaveOnSharePreference.isEnabled(this) && !isStaleTarget
    // Marked as an automatic save from the start, so the foreground router never opens it for
    // review while that save is still running (see IncomingShareRouter).
    val pendingShareId = PendingShareQueue.capture(this, intent, preselectedCollectionId, autoSave = quickSaveOn)
    Log.d(LogTag, "captured pendingShare=${pendingShareId != null} quickSaveOn=$quickSaveOn staleTarget=$isStaleTarget")
    if (pendingShareId != null && isStaleTarget) {
      ShortcutLaunchStore.setNotice(this, ShortcutNoticeTargetUnavailable)
    }

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

  private sealed class DirectShareTarget {
    /** The plain Juple target (or a shortcut id this app never minted): the generic share flow. */
    object None : DirectShareTarget()

    /** A Collection the user pinned. Still only a claim - the JS side re-validates it with the backend before using it. */
    data class Pinned(val collectionId: Long) : DirectShareTarget()

    /** One of this app's Collection shortcuts, but that Collection is no longer pinned (removed / renamed away / signed out). */
    object Stale : DirectShareTarget()
  }

  /**
   * A Direct Share Collection row's EXTRA_SHORTCUT_ID is set automatically by the system (Sharing
   * Shortcuts API contract) when the user picks it in the Sharesheet - never set by Juple's own
   * Intent, and never trusted as authorization: it only names a Collection to try.
   */
  private fun resolveDirectShareTarget(): DirectShareTarget {
    val shortcutId = intent?.getStringExtra(Intent.EXTRA_SHORTCUT_ID) ?: return DirectShareTarget.None
    val categoryId = ShortcutSyncManager.categoryIdFromShortcutId(shortcutId) ?: return DirectShareTarget.None
    return if (CollectionShortcutPreferenceStore.findById(this, categoryId) != null) {
      DirectShareTarget.Pinned(categoryId)
    } else {
      DirectShareTarget.Stale
    }
  }

  companion object {
    private const val LogTag = "JupleShare"

    /** Must match shortcutLaunchNotice.ts. */
    private const val ShortcutNoticeTargetUnavailable = "targetUnavailable"
  }
}
