package com.juple.app

import android.content.Intent
import com.facebook.react.HeadlessJsTaskService
import com.facebook.react.bridge.Arguments
import com.facebook.react.jstasks.HeadlessJsTaskConfig

/**
 * Starts the [TaskKey] JS task with only the pending share id. The task itself reads the
 * shared text from [PendingShareQueue] via the NativeIncomingShare bridge; nothing else is
 * duplicated into the Intent.
 */
class IncomingShareHeadlessService : HeadlessJsTaskService() {
  override fun getTaskConfig(intent: Intent?): HeadlessJsTaskConfig? {
    val pendingShareId = intent?.getStringExtra(ExtraPendingShareId) ?: return null

    val data = Arguments.createMap().apply {
      putString("pendingShareId", pendingShareId)
    }

    return HeadlessJsTaskConfig(
      TaskKey,
      data,
      TaskTimeoutMs,
      true,
    )
  }

  companion object {
    const val ExtraPendingShareId = "com.juple.app.EXTRA_PENDING_SHARE_ID"
    const val TaskKey = "JupleIncomingShareTask"
    const val TaskTimeoutMs = 45_000L
  }
}
