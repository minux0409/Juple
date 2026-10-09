package com.juple.app

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject

/** One Collection the user explicitly added to the app's launcher / Direct Share shortcuts. */
data class PinnedCollectionEntry(
  val id: Long,
  val name: String,
  /** What the Collection's icon is drawn from (see CollectionShortcutIcon) - the same data its card uses. All optional: an entry written by an older build has none. */
  val iconKey: String? = null,
  val tileColor: String? = null,
  val glyphColor: String? = null,
  /** The version of the Collection's own photo, if it has one (the photo itself is cached by CollectionIconImages; its signed URL is never stored). */
  val imageVersion: String? = null,
)

/**
 * Native-readable list of the Collections ("카테고리") the user EXPLICITLY added to the app shortcuts (Collection
 * long-press > 앱 바로가기에 추가) - a device-local choice, never synced to the backend, and never "every Collection":
 * a launcher / share-sheet label is visible outside Juple's own protected UI, so nothing is published unless the user
 * picked it. JS (CollectionShortcutService) is the only writer; this store is only a cache the OS-facing side needs
 * even when JS/the app isn't running: building the launcher + Direct Share shortcuts (see ShortcutSyncManager) and
 * telling ShareReceiverActivity whether a shortcut-resolved Collection is still one the user pinned.
 *
 * The earlier build mirrored EVERY owned Collection here under the "entries" key; [purgeLegacy] drops that once, so an
 * upgrade never keeps publishing Collections nobody picked.
 */
object CollectionShortcutPreferenceStore {
  private const val PreferencesName = "juple_category_snapshot"
  private const val Key = "pinned"
  private const val LegacyKey = "entries"
  private val lock = Any()

  fun set(context: Context, pinned: List<PinnedCollectionEntry>) {
    synchronized(lock) {
      val array = JSONArray()
      pinned.forEach { entry ->
        array.put(
          JSONObject()
            .put("id", entry.id)
            .put("name", entry.name)
            .putOpt("iconKey", entry.iconKey)
            .putOpt("tileColor", entry.tileColor)
            .putOpt("glyphColor", entry.glyphColor)
            .putOpt("imageVersion", entry.imageVersion),
        )
      }
      context.getSharedPreferences(PreferencesName, Context.MODE_PRIVATE)
        .edit()
        .putString(Key, array.toString())
        .commit()
    }
  }

  fun get(context: Context): List<PinnedCollectionEntry> = synchronized(lock) {
    val serialized = context.getSharedPreferences(PreferencesName, Context.MODE_PRIVATE)
      .getString(Key, null) ?: return emptyList()
    parse(serialized)
  }

  fun clear(context: Context) {
    synchronized(lock) {
      context.getSharedPreferences(PreferencesName, Context.MODE_PRIVATE).edit().clear().commit()
    }
  }

  fun findById(context: Context, id: Long): PinnedCollectionEntry? =
    get(context).firstOrNull { it.id == id }

  /** True when the earlier "every Collection" mirror was still stored (and is now removed) - the caller drops the shortcuts it published. */
  fun purgeLegacy(context: Context): Boolean = synchronized(lock) {
    val preferences = context.getSharedPreferences(PreferencesName, Context.MODE_PRIVATE)
    if (!preferences.contains(LegacyKey)) {
      return false
    }
    preferences.edit().remove(LegacyKey).commit()
    true
  }

  /** Parses the stored / bridge JSON ([{"id":1,"name":"x"}]); anything malformed is skipped, never thrown. */
  fun parse(serialized: String): List<PinnedCollectionEntry> {
    val array = try {
      JSONArray(serialized)
    } catch (_: Exception) {
      return emptyList()
    }
    return buildList {
      for (index in 0 until array.length()) {
        val entry = array.optJSONObject(index) ?: continue
        val id = entry.optLong("id", -1)
        if (id < 0 || !entry.has("name")) {
          continue
        }
        val name = entry.optString("name")
        if (name.isBlank() || any { it.id == id }) {
          continue
        }
        fun optional(key: String): String? = if (entry.has(key) && !entry.isNull(key)) entry.optString(key).takeIf { it.isNotBlank() } else null
        add(PinnedCollectionEntry(id, name, optional("iconKey"), optional("tileColor"), optional("glyphColor"), optional("imageVersion")))
      }
    }
  }
}
