package com.juple.app

import android.app.Activity
import android.content.Intent
import android.os.Bundle

/**
 * Receives ACTION_SEND from the Android sharesheet. Never displays any UI: it captures the
 * share into [PendingShareQueue], schedules a durable [IncomingShareRetryScheduler] fallback in
 * case the immediate attempt fails or the process dies, hands the pending share id to
 * [IncomingShareHeadlessService] for a best-effort immediate background save, and finishes
 * immediately so the source app stays in front.
 */
class ShareReceiverActivity : Activity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)

    val pendingShareId = PendingShareQueue.capture(this, intent)
    if (pendingShareId != null) {
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
    }

    finish()
  }
}
