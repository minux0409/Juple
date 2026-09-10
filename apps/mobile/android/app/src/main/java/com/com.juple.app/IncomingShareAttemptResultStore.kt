package com.juple.app

import android.content.Context

/**
 * Transient pendingShareId -> last attempt outcome metadata, reported by the JS headless task and
 * consumed by [IncomingShareRetryWorker] to decide whether a still-pending share is worth a
 * delayed retry. [PendingShareQueue] remains the sole source of truth for whether a share is
 * actually saved; this store only carries the WHY for a share that is still pending after an
 * attempt, and is not saved/production data in its own right.
 */
object IncomingShareAttemptResultStore {
  private const val PreferencesName = "juple_incoming_share_attempt_results"

  enum class Outcome(val wireValue: String) {
    ReviewRequired("reviewRequired"),
    AuthenticationRequired("authenticationRequired"),
    RetryableFailure("retryableFailure"),
    PermanentFailure("permanentFailure");

    companion object {
      fun fromWireValue(value: String?): Outcome? = entries.firstOrNull { it.wireValue == value }
    }
  }

  fun clear(context: Context, pendingShareId: String) {
    prefs(context).edit().remove(pendingShareId).commit()
  }

  fun report(context: Context, pendingShareId: String, outcome: String) {
    prefs(context).edit().putString(pendingShareId, outcome).commit()
  }

  /** Reads and removes the stored outcome for [pendingShareId], if any. */
  fun consume(context: Context, pendingShareId: String): Outcome? {
    val preferences = prefs(context)
    val value = preferences.getString(pendingShareId, null)
    if (value != null) {
      preferences.edit().remove(pendingShareId).commit()
    }
    return Outcome.fromWireValue(value)
  }

  /**
   * Non-destructive read for the Quick Save composer's outcome polling (see
   * NativeIncomingShareModule.getQuickSaveOutcome) - unlike [consume], never removes the stored
   * value, since [IncomingShareRetryWorker] is the only thing allowed to consume it for its own
   * retry decision.
   */
  fun peek(context: Context, pendingShareId: String): Outcome? =
    Outcome.fromWireValue(prefs(context).getString(pendingShareId, null))

  private fun prefs(context: Context) =
    context.getSharedPreferences(PreferencesName, Context.MODE_PRIVATE)
}
