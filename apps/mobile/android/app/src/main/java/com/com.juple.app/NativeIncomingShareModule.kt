package com.juple.app

import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.WritableArray
import com.facebook.react.module.annotations.ReactModule
import com.facebook.react.turbomodule.core.interfaces.TurboModule

@ReactModule(name = NativeIncomingShareModule.Name)
class NativeIncomingShareModule(
    private val reactContext: ReactApplicationContext,
) : NativeIncomingShareSpec(reactContext), TurboModule {
  override fun getName(): String = Name

  override fun getPendingShares(promise: Promise) {
    val shares: WritableArray = Arguments.createArray()
    PendingShareQueue.getPendingShares(reactContext).forEach { share ->
      shares.pushMap(
        Arguments.createMap().apply {
          putString("id", share.id)
          putString("text", share.text)
          putDouble("receivedAtEpochMs", share.receivedAtEpochMs.toDouble())
        },
      )
    }
    promise.resolve(shares)
  }

  override fun acknowledgePendingShare(id: String, promise: Promise) {
    PendingShareQueue.acknowledge(reactContext, id)
    promise.resolve(null)
  }

  override fun reportAttemptOutcome(pendingShareId: String, outcome: String, promise: Promise) {
    IncomingShareAttemptResultStore.report(reactContext, pendingShareId, outcome)
    promise.resolve(null)
  }

  override fun setQuickSaveOnShare(enabled: Boolean, promise: Promise) {
    QuickSaveOnSharePreference.set(reactContext, enabled)
    promise.resolve(null)
  }

  companion object {
    const val Name = "NativeIncomingShare"
  }
}