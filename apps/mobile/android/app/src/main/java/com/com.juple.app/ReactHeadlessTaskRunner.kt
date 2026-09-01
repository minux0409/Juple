package com.juple.app

import android.content.Context
import com.facebook.react.ReactApplication
import com.facebook.react.ReactInstanceEventListener
import com.facebook.react.bridge.ReactContext
import com.facebook.react.bridge.UiThreadUtil
import com.facebook.react.bridge.WritableMap
import com.facebook.react.jstasks.HeadlessJsTaskConfig
import com.facebook.react.jstasks.HeadlessJsTaskContext
import com.facebook.react.jstasks.HeadlessJsTaskEventListener
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withTimeoutOrNull

/**
 * Isolated adapter over React Native's low-level ReactHost / HeadlessJsTaskContext APIs, used
 * only by [IncomingShareRetryWorker]. A Worker must not call startService/startForegroundService
 * on [IncomingShareHeadlessService] (that would re-enter Android's background-service-start
 * restrictions), so this drives the same underlying task machinery directly instead. Reuses the
 * app's existing [ReactHost] / [ReactContext] when already initialized, or cold-starts it, but
 * never destroys it - other app code may still need it after this runner finishes.
 *
 * If a future RN upgrade changes these low-level signatures, only this file needs to be updated.
 */
object ReactHeadlessTaskRunner {
  private const val RunnerTimeoutMs = 60_000L
  private const val TaskTimeoutMs = 45_000L

  /** Runs [taskKey] once with [data] and suspends until it finishes, times out, or this runner's own safety timeout elapses. */
  suspend fun runTask(context: Context, taskKey: String, data: WritableMap) {
    withTimeoutOrNull(RunnerTimeoutMs) {
      val reactContext = awaitReactContext(context.applicationContext)
      runHeadlessTask(reactContext, taskKey, data)
    }
  }

  private suspend fun awaitReactContext(appContext: Context): ReactContext {
    val reactHost = checkNotNull((appContext as ReactApplication).reactHost) {
      "ReactApplication.reactHost was null; MainApplication always provides one"
    }

    reactHost.currentReactContext?.let { return it }

    return suspendCancellableCoroutine { continuation ->
      lateinit var listener: ReactInstanceEventListener
      listener = object : ReactInstanceEventListener {
        override fun onReactContextInitialized(context: ReactContext) {
          reactHost.removeReactInstanceEventListener(listener)
          if (continuation.isActive) {
            continuation.resumeWith(Result.success(context))
          }
        }
      }

      UiThreadUtil.runOnUiThread {
        reactHost.addReactInstanceEventListener(listener)
        val alreadyInitialized = reactHost.currentReactContext
        if (alreadyInitialized != null) {
          reactHost.removeReactInstanceEventListener(listener)
          if (continuation.isActive) {
            continuation.resumeWith(Result.success(alreadyInitialized))
          }
        } else {
          reactHost.start()
        }
      }

      continuation.invokeOnCancellation {
        UiThreadUtil.runOnUiThread { reactHost.removeReactInstanceEventListener(listener) }
      }
    }
  }

  private suspend fun runHeadlessTask(
    reactContext: ReactContext,
    taskKey: String,
    data: WritableMap,
  ) {
    return suspendCancellableCoroutine { continuation ->
      val taskContext = HeadlessJsTaskContext.getInstance(reactContext)
      var runningTaskId = -1

      lateinit var listener: HeadlessJsTaskEventListener
      listener = object : HeadlessJsTaskEventListener {
        override fun onHeadlessJsTaskStart(taskId: Int) = Unit

        override fun onHeadlessJsTaskFinish(taskId: Int) {
          if (taskId != runningTaskId) return
          taskContext.removeTaskEventListener(listener)
          if (continuation.isActive) {
            continuation.resumeWith(Result.success(Unit))
          }
        }
      }

      UiThreadUtil.runOnUiThread {
        taskContext.addTaskEventListener(listener)
        val config = HeadlessJsTaskConfig(taskKey, data, TaskTimeoutMs, true)
        runningTaskId = taskContext.startTask(config)
        if (!taskContext.isTaskRunning(runningTaskId)) {
          taskContext.removeTaskEventListener(listener)
          if (continuation.isActive) {
            continuation.resumeWith(Result.success(Unit))
          }
        }
      }

      continuation.invokeOnCancellation {
        UiThreadUtil.runOnUiThread { taskContext.removeTaskEventListener(listener) }
      }
    }
  }
}
