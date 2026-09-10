package com.juple.app

import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.WritableArray
import com.facebook.react.bridge.WritableMap
import com.facebook.react.module.annotations.ReactModule
import com.facebook.react.turbomodule.core.interfaces.TurboModule
import org.json.JSONArray

private const val NoCollectionId = -1L

private fun WritableMap.putNullableLong(key: String, value: Long?) {
  if (value != null) putDouble(key, value.toDouble()) else putNull(key)
}

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
          putString("initialTitle", share.initialTitle)
          putNullableLong("preselectedCollectionId", share.preselectedCollectionId)
          putString("draftTitle", share.draftTitle)
          putNullableLong("draftCollectionId", share.draftCollectionId)
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

  override fun getCategorySnapshot(promise: Promise) {
    val snapshot: WritableArray = Arguments.createArray()
    CategorySnapshotStore.get(reactContext).forEach { category ->
      snapshot.pushMap(
        Arguments.createMap().apply {
          putDouble("id", category.id.toDouble())
          putString("name", category.name)
          putBoolean("isFavorite", category.isFavorite)
        },
      )
    }
    promise.resolve(snapshot)
  }

  override fun setCategorySnapshot(categoriesJson: String, promise: Promise) {
    val entries = try {
      val array = JSONArray(categoriesJson)
      buildList {
        for (index in 0 until array.length()) {
          val entry = array.optJSONObject(index) ?: continue
          val id = entry.optLong("id", -1)
          if (id < 0 || !entry.has("name")) {
            continue
          }
          add(CategorySnapshotEntry(id, entry.optString("name"), entry.optBoolean("isFavorite")))
        }
      }
    } catch (_: Exception) {
      emptyList()
    }

    CategorySnapshotStore.set(reactContext, entries)
    ShortcutSyncManager.sync(reactContext, entries)
    promise.resolve(null)
  }

  override fun submitQuickSaveDraft(
    pendingShareId: String,
    title: String,
    collectionId: Double,
    promise: Promise,
  ) {
    val resolvedCollectionId = collectionId.toLong().takeIf { it != NoCollectionId }
    val resolvedTitle = title.trim().takeIf { it.isNotEmpty() }

    PendingShareQueue.submitDraft(reactContext, pendingShareId, resolvedTitle, resolvedCollectionId)
    IncomingShareSaveScheduler.schedule(reactContext, pendingShareId)
    promise.resolve(null)
  }

  override fun getQuickSaveOutcome(pendingShareId: String, promise: Promise) {
    val stillPending = PendingShareQueue.getPendingShares(reactContext)
      .any { it.id == pendingShareId }

    if (!stillPending) {
      promise.resolve("success")
      return
    }

    val outcome = IncomingShareAttemptResultStore.peek(reactContext, pendingShareId)
    promise.resolve(outcome?.wireValue ?: "pending")
  }

  override fun finishComposerActivity(promise: Promise) {
    reactContext.currentActivity?.finish()
    promise.resolve(null)
  }

  override fun clearCategoryShortcuts(promise: Promise) {
    ShortcutSyncManager.clear(reactContext)
    CategorySnapshotStore.clear(reactContext)
    promise.resolve(null)
  }

  companion object {
    const val Name = "NativeIncomingShare"
  }
}
