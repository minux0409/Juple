package com.juple.app

import android.content.Context
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
import com.facebook.react.bridge.Arguments

/**
 * Single delayed "second chance" attempt for a pending share whose immediate
 * [IncomingShareHeadlessService] save may have failed or never ran (process death). Runs the same
 * [IncomingShareHeadlessService.TaskKey] JS task exactly once via [ReactHeadlessTaskRunner]; the
 * JS task itself decides whether to save and, on success, removes the pending share from
 * [PendingShareQueue]. This Worker never retries - it always returns [Result.success] so
 * WorkManager does not re-enqueue it.
 */
class IncomingShareRetryWorker(
  context: Context,
  workerParams: WorkerParameters,
) : CoroutineWorker(context, workerParams) {

  override suspend fun doWork(): Result {
    val pendingShareId = inputData.getString(InputPendingShareId) ?: return Result.success()

    val stillPending = PendingShareQueue.getPendingShares(applicationContext)
      .any { it.id == pendingShareId }
    if (!stillPending) {
      // The immediate save already succeeded (or the share was otherwise resolved).
      return Result.success()
    }

    val data = Arguments.createMap().apply {
      putString("pendingShareId", pendingShareId)
    }
    ReactHeadlessTaskRunner.runTask(applicationContext, IncomingShareHeadlessService.TaskKey, data)

    return Result.success()
  }

  companion object {
    const val InputPendingShareId = "pendingShareId"
  }
}
