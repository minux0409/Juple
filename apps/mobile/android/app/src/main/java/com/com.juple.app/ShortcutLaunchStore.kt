package com.juple.app

import android.content.Context
import android.content.Intent

/** What the app should do on its next look after a launcher shortcut / a Direct Share left something for it. */
data class ShortcutLaunch(val openCollectionId: Long?, val notice: String?)

/**
 * A small hand-off from the OS-facing side (MainActivity receiving a launcher-shortcut tap; the headless share save
 * finding its Collection no longer usable) to the JS router that owns navigation and messages. Persisted, because the JS
 * side may not be running when the intent arrives, and consumed exactly once. Holds only a Collection id and a notice
 * CODE - never a name, URL or any shared content. The id is NOT trusted: the JS router re-reads the Collection from the
 * backend (which enforces access) before opening anything.
 */
object ShortcutLaunchStore {
  private const val PreferencesName = "juple_shortcut_launch"
  private const val OpenCollectionKey = "openCollectionId"
  private const val NoticeKey = "notice"
  private val lock = Any()

  /** Records a launcher-shortcut tap; returns whether [intent] was one. The extras are cleared so a re-delivery is not a second open. */
  fun captureOpenCollection(context: Context, intent: Intent?): Boolean {
    if (intent?.action != ShortcutSyncManager.ActionOpenCollection) {
      return false
    }
    val collectionId = intent.getLongExtra(ShortcutSyncManager.ExtraCollectionId, -1L)
    intent.action = Intent.ACTION_MAIN
    intent.removeExtra(ShortcutSyncManager.ExtraCollectionId)
    if (collectionId < 0) {
      return false
    }
    synchronized(lock) {
      context.getSharedPreferences(PreferencesName, Context.MODE_PRIVATE)
        .edit()
        .putLong(OpenCollectionKey, collectionId)
        .commit()
    }
    return true
  }

  fun setNotice(context: Context, code: String) {
    synchronized(lock) {
      context.getSharedPreferences(PreferencesName, Context.MODE_PRIVATE)
        .edit()
        .putString(NoticeKey, code)
        .commit()
    }
  }

  fun consume(context: Context): ShortcutLaunch = synchronized(lock) {
    val preferences = context.getSharedPreferences(PreferencesName, Context.MODE_PRIVATE)
    val openId = if (preferences.contains(OpenCollectionKey)) preferences.getLong(OpenCollectionKey, -1L) else -1L
    val notice = preferences.getString(NoticeKey, null)
    if (preferences.contains(OpenCollectionKey) || notice != null) {
      preferences.edit().clear().commit()
    }
    ShortcutLaunch(if (openId >= 0) openId else null, notice)
  }

  fun clear(context: Context) {
    synchronized(lock) {
      context.getSharedPreferences(PreferencesName, Context.MODE_PRIVATE).edit().clear().commit()
    }
  }
}
