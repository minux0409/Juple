package com.juple.app

import android.content.Context
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
import com.facebook.react.bridge.Arguments
import kotlinx.coroutines.CancellationException

/**
 * Delayed "second chance" attempt for a pending share whose immediate
 * [IncomingShareHeadlessService] save may have failed or never ran (process death). Runs the same
 * [IncomingShareHeadlessService.TaskKey] JS task via [ReactHeadlessTaskRunner]; the JS task itself
 * decides whether to save and, on success, removes the pending share from [PendingShareQueue].
 *
 * When the share is still pending afterward, the JS task's reported
 * [IncomingShareAttemptResultStore.Outcome] decides what happens next: only a genuinely
 * retryable/unknown outcome schedules another attempt (via [androidx.work.ListenableWorker.Result.retry],
 * bounded by [MaxAttempts] and the exponential backoff configured in [IncomingShareRetryScheduler]).
 * Every other outcome - including running out of attempts - ends in [androidx.work.ListenableWorker.Result.success]
 * with the pending share left in place for manual review or a future launch to surface.
 */
class IncomingShareRetryWorker(
  context: Context,
  workerParams: WorkerParameters,
) : CoroutineWorker(context, workerParams) {

  override suspend fun doWork(): Result {
    val pendingShareId = inputData.getString(InputPendingShareId) ?: return Result.success()

    val stillPendingBefore = PendingShareQueue.getPendingShares(applicationContext)
      .any { it.id == pendingShareId }
    if (!stillPendingBefore) {
      // The immediate save already succeeded (or the share was otherwise resolved).
      return Result.success()
    }

    // Discard any outcome left over from the immediate attempt or an earlier retry, so only this
    // run's own result is read below.
    IncomingShareAttemptResultStore.clear(applicationContext, pendingShareId)

    val data = Arguments.createMap().apply {
      putString("pendingShareId", pendingShareId)
    }
    try {
      ReactHeadlessTaskRunner.runTask(applicationContext, IncomingShareHeadlessService.TaskKey, data)
    } catch (cancellation: CancellationException) {
      throw cancellation
    } catch (_: Exception) {
      // Treated as a missing outcome below, same as a JS crash or a task that never reported.
    }

    val stillPendingAfter = PendingShareQueue.getPendingShares(applicationContext)
      .any { it.id == pendingShareId }
    if (!stillPendingAfter) {
      return Result.success()
    }

    return when (IncomingShareAttemptResultStore.consume(applicationContext, pendingShareId)) {
      IncomingShareAttemptResultStore.Outcome.ReviewRequired,
      IncomingShareAttemptResultStore.Outcome.AuthenticationRequired,
      IncomingShareAttemptResultStore.Outcome.PermanentFailure,
      -> Result.success()

      IncomingShareAttemptResultStore.Outcome.RetryableFailure,
      null,
      -> if (runAttemptCount >= MaxAttempts - 1) Result.success() else Result.retry()
    }
  }

  companion object {
    const val InputPendingShareId = "pendingShareId"

    /** Total Worker executions allowed for one pending share, including the first (non-retry) run. */
    private const val MaxAttempts = 7
  }
}
