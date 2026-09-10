package com.juple.app

import android.content.Context
import android.content.Intent

/**
 * Starts the durable background save path for a pending share whose draft (title/category) has
 * just been confirmed by the user in the Quick Save composer - moved here from
 * ShareReceiverActivity, which used to call this unconditionally and immediately on every ON-mode
 * share. Schedules the [IncomingShareRetryScheduler] fallback first, then makes a best-effort
 * immediate attempt via [IncomingShareHeadlessService]; if that immediate start fails (background
 * start restrictions, process death), the already-scheduled Worker still covers it.
 */
object IncomingShareSaveScheduler {
  fun schedule(context: Context, pendingShareId: String) {
    IncomingShareRetryScheduler.schedule(context, pendingShareId)

    try {
      context.startService(
        Intent(context, IncomingShareHeadlessService::class.java)
          .putExtra(IncomingShareHeadlessService.ExtraPendingShareId, pendingShareId),
      )
    } catch (_: Exception) {
      // The pending share (with its draft already persisted) is durable; the fallback Worker will
      // still surface/save it.
    }
  }
}
