package com.juple.app

import android.app.Activity
import android.content.Intent
import android.os.Bundle

/**
 * Receives ACTION_SEND from the Android sharesheet. Never displays any UI itself: it captures the
 * share into [PendingShareQueue], then branches on the "공유 즉시 저장" preference
 * ([QuickSaveOnSharePreference], default true/ON):
 * - ON: exact pre-existing behavior - schedules a durable [IncomingShareRetryScheduler] fallback
 *   in case the immediate attempt fails or the process dies, hands the pending share id to
 *   [IncomingShareHeadlessService] for a best-effort immediate silent background save, and
 *   finishes immediately so the source app stays in front.
 * - OFF: neither the retry worker nor the headless service is started - nothing then ever calls
 *   the save API automatically, which is what prevents a duplicate save - instead MainActivity is
 *   launched so the app's existing pending-share prefill/review UI (useIncomingShare) takes over
 *   once the user taps Save themselves.
 */
class ShareReceiverActivity : Activity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)

    val pendingShareId = PendingShareQueue.capture(this, intent)
    if (pendingShareId != null) {
      if (QuickSaveOnSharePreference.isEnabled(this)) {
        IncomingShareRetryScheduler.schedule(this, pendingShareId)

        try {
          startService(
            Intent(this, IncomingShareHeadlessService::class.java)
              .putExtra(IncomingShareHeadlessService.ExtraPendingShareId, pendingShareId),
          )
        } catch (_: Exception) {
          // The pending share is already persisted; the fallback Worker or a normal Juple launch
          // will still surface it for review.
        }
      } else {
        startActivity(
          Intent(this, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
        )
      }
    }

    finish()
  }
}
