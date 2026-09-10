package com.juple.app

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject

data class CategorySnapshotEntry(
  val id: Long,
  val name: String,
  val isFavorite: Boolean,
)

/**
 * Native-readable mirror of the user's Collections ("카테고리"), synced from JS whenever the
 * Categories tab loads or a Collection is created/renamed/deleted/favorited (see
 * categorySnapshotSync.ts) - never a second source of truth, only a cache for two things the OS
 * needs even when JS/the app isn't running: populating the Quick Save composer's category picker
 * instantly, and building Direct Share dynamic shortcuts (see ShortcutSyncManager). A stale/empty
 * snapshot (e.g. right after a fresh login before the first sync) degrades to "no categories to
 * pick from" rather than crashing anything.
 */
object CategorySnapshotStore {
  private const val PreferencesName = "juple_category_snapshot"
  private const val Key = "entries"
  private val lock = Any()

  fun set(context: Context, categories: List<CategorySnapshotEntry>) {
    synchronized(lock) {
      val array = JSONArray()
      categories.forEach { category ->
        array.put(
          JSONObject()
            .put("id", category.id)
            .put("name", category.name)
            .put("isFavorite", category.isFavorite),
        )
      }
      context.getSharedPreferences(PreferencesName, Context.MODE_PRIVATE)
        .edit()
        .putString(Key, array.toString())
        .commit()
    }
  }

  fun get(context: Context): List<CategorySnapshotEntry> = synchronized(lock) {
    val serialized = context.getSharedPreferences(PreferencesName, Context.MODE_PRIVATE)
      .getString(Key, null) ?: return emptyList()

    val array = try {
      JSONArray(serialized)
    } catch (_: Exception) {
      return emptyList()
    }

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
  }

  fun clear(context: Context) {
    synchronized(lock) {
      context.getSharedPreferences(PreferencesName, Context.MODE_PRIVATE).edit().clear().commit()
    }
  }

  fun findById(context: Context, id: Long): CategorySnapshotEntry? =
    get(context).firstOrNull { it.id == id }
}
