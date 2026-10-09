package com.juple.app

import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.WritableArray
import com.facebook.react.bridge.WritableMap
import com.facebook.react.module.annotations.ReactModule
import com.facebook.react.turbomodule.core.interfaces.TurboModule

private fun WritableMap.putNullableLong(key: String, value: Long?) {
  if (value != null) putDouble(key, value.toDouble()) else putNull(key)
}

@ReactModule(name = NativeIncomingShareModule.Name)
class NativeIncomingShareModule(
    private val reactContext: ReactApplicationContext,
) : NativeIncomingShareSpec(reactContext), TurboModule {
  override fun getName(): String = Name

  private val background = java.util.concurrent.Executors.newSingleThreadExecutor()

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
          putBoolean("autoSave", share.autoSave)
          // Whether this share's automatic save already ended without saving it (see
          // IncomingShareRouter) - peeked, never consumed: the retry Worker still reads it.
          putString("autoSaveOutcome", IncomingShareAttemptResultStore.peek(reactContext, share.id)?.wireValue)
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

  override fun getPinnedCollectionShortcuts(promise: Promise) {
    ShortcutSyncManager.migrateLegacy(reactContext)
    val pinned: WritableArray = Arguments.createArray()
    CollectionShortcutPreferenceStore.get(reactContext).forEach { entry ->
      pinned.pushMap(
        Arguments.createMap().apply {
          putDouble("id", entry.id.toDouble())
          putString("name", entry.name)
          putString("iconKey", entry.iconKey)
          putString("tileColor", entry.tileColor)
          putString("glyphColor", entry.glyphColor)
          putString("imageVersion", entry.imageVersion)
        },
      )
    }
    promise.resolve(pinned)
  }

  override fun setPinnedCollectionShortcuts(pinnedJson: String, promise: Promise) {
    // The photos (a short, capped fetch per NEW version) are prepared first, off the JS and UI threads; then the whole set is
    // stored and republished in one go. A photo that cannot be prepared only means that icon is drawn from its configured glyph.
    background.execute {
      try {
        val entries = CollectionShortcutPreferenceStore.parse(pinnedJson)
        val urls = imageUrlsOf(pinnedJson)
        entries.forEach { entry ->
          if (entry.imageVersion != null) {
            CollectionIconImages.prepare(reactContext, entry.id, entry.imageVersion, urls[entry.id])
          }
        }
        CollectionShortcutPreferenceStore.set(reactContext, entries)
        ShortcutSyncManager.sync(reactContext, entries)
        promise.resolve(null)
      } catch (error: Exception) {
        promise.reject("shortcut_sync_failed", error.javaClass.simpleName)
      }
    }
  }

  /** The transient signed photo links that came with the set - used only to prepare the photos, never stored. */
  private fun imageUrlsOf(pinnedJson: String): Map<Long, String> =
    try {
      val array = org.json.JSONArray(pinnedJson)
      (0 until array.length()).mapNotNull { index ->
        val entry = array.optJSONObject(index) ?: return@mapNotNull null
        val url = entry.optString("imageUrl")
        if (url.isNullOrBlank() || !entry.has("id")) null else entry.optLong("id") to url
      }.toMap()
    } catch (_: Exception) {
      emptyMap()
    }

  override fun getMaxPinnedCollectionShortcuts(promise: Promise) {
    promise.resolve(ShortcutSyncManager.maxShortcuts(reactContext).toDouble())
  }

  override fun clearPinnedCollectionShortcuts(promise: Promise) {
    ShortcutSyncManager.clear(reactContext)
    CollectionShortcutPreferenceStore.clear(reactContext)
    ShortcutLaunchStore.clear(reactContext)
    promise.resolve(null)
  }

  override fun consumeShortcutLaunch(promise: Promise) {
    val launch = ShortcutLaunchStore.consume(reactContext)
    promise.resolve(
      Arguments.createMap().apply {
        putNullableLong("openCollectionId", launch.openCollectionId)
        putString("notice", launch.notice)
      },
    )
  }

  override fun isHomeShortcutSupported(promise: Promise) {
    promise.resolve(HomeShortcutPinner.isSupported(reactContext))
  }

  override fun requestHomeShortcut(
    collectionId: Double,
    name: String,
    iconKey: String,
    tileColor: String,
    glyphColor: String,
    imageUrl: String,
    imageVersion: String,
    shareable: Boolean,
    promise: Promise,
  ) {
    // The launcher shows its own confirmation; this only reports whether the request could be made. Whether the user
    // accepted is reported later, to PinShortcutResultReceiver - never assumed here. Preparing a photo may take a moment, so
    // this never runs on the UI thread; empty strings mean "none".
    background.execute {
      val result = try {
        HomeShortcutPinner.request(
          reactContext,
          collectionId.toLong(),
          name,
          iconKey.ifBlank { null },
          tileColor.ifBlank { null },
          glyphColor.ifBlank { null },
          imageUrl.ifBlank { null },
          imageVersion.ifBlank { null },
          shareable,
        )
      } catch (_: Exception) {
        HomeShortcutPinner.Unsupported
      }
      promise.resolve(result)
    }
  }

  override fun setShortcutNotice(code: String, promise: Promise) {
    ShortcutLaunchStore.setNotice(reactContext, code)
    promise.resolve(null)
  }

  companion object {
    const val Name = "NativeIncomingShare"
  }
}
