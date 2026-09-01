package com.juple.app

import android.content.Context
import androidx.work.BackoffPolicy
import androidx.work.Constraints
import androidx.work.Data
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import java.util.concurrent.TimeUnit

/**
 * Schedules a delayed [IncomingShareRetryWorker] fallback per pending share, in case the
 * immediate [IncomingShareHeadlessService] save fails or the process dies before it finishes. The
 * 60s initial delay only needs to avoid racing the immediate attempt (up to ~45s); it is not
 * exact-alarm precision. ExistingWorkPolicy.KEEP keeps this to at most one scheduled fallback per
 * share id at a time (the Worker itself, not a second `schedule` call, drives any further
 * attempts via `Result.retry()` and the exponential backoff below, bounded by
 * [IncomingShareRetryWorker]'s own attempt cap).
 *
 * PendingShareQueue is app-private persistent storage, so a pending share survives process death
 * and force-stop. WorkManager provides persistent work recovery, but Android stopped state / OEM
 * battery restrictions / user action can still delay or prevent this Worker from running; if that
 * happens, relaunching Juple still recovers the pending share for manual review.
 */
object IncomingShareRetryScheduler {
  private const val InitialDelaySeconds = 60L
  private const val BackoffDelayMinutes = 1L

  fun schedule(context: Context, pendingShareId: String) {
    val constraints = Constraints.Builder()
      .setRequiredNetworkType(NetworkType.CONNECTED)
      .build()

    val request = OneTimeWorkRequestBuilder<IncomingShareRetryWorker>()
      .setInitialDelay(InitialDelaySeconds, TimeUnit.SECONDS)
      .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, BackoffDelayMinutes, TimeUnit.MINUTES)
      .setConstraints(constraints)
      .setInputData(
        Data.Builder()
          .putString(IncomingShareRetryWorker.InputPendingShareId, pendingShareId)
          .build(),
      )
      .build()

    WorkManager.getInstance(context)
      .enqueueUniqueWork(
        "juple-incoming-share-$pendingShareId",
        ExistingWorkPolicy.KEEP,
        request,
      )
  }
}
