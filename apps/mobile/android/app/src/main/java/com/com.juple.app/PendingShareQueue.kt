package com.juple.app

import android.content.ClipData
import android.content.Context
import android.content.Intent
import org.json.JSONArray
import org.json.JSONObject
import java.util.UUID

data class PendingShare(
    val id: String,
    val text: String,
    val receivedAtEpochMs: Long,
    /** Best-effort title from the sharing app's own Intent (see ShareIntentTitleExtractor) - never guessed, null when the sharing app provided none. */
    val initialTitle: String?,
    /** Resolved once at capture time from a matched Direct Share category shortcut (see ShareReceiverActivity) - null for the generic Juple target. */
    val preselectedCollectionId: Long?,
    /** Always null - reserved wire-format field, kept for native queue schema compatibility with a since-removed Quick Save composer draft. */
    val draftTitle: String?,
    val draftCollectionId: Long?,
)

object PendingShareQueue {
  private const val PreferencesName = "juple_pending_shares"
  private const val QueueKey = "entries"
  private val lock = Any()

  /** Captures an ACTION_SEND text/plain intent and returns the new pending share's id, or null if not applicable. */
  fun capture(context: Context, intent: Intent?, preselectedCollectionId: Long?): String? {
    if (intent?.action != Intent.ACTION_SEND || intent.type != "text/plain") {
      return null
    }

    val text = intent.getCharSequenceExtra(Intent.EXTRA_TEXT)?.toString()
      ?: getClipText(intent.clipData)
      ?: return null

    val initialTitle = ShareIntentTitleExtractor.extract(intent, text)

    val id = UUID.randomUUID().toString()
    synchronized(lock) {
      val entries = readEntries(context)
      entries.put(
        JSONObject()
          .put("id", id)
          .put("text", text)
          .put("receivedAtEpochMs", System.currentTimeMillis())
          .putOpt("initialTitle", initialTitle)
          .putOpt("preselectedCollectionId", preselectedCollectionId),
      )
      writeEntries(context, entries)
    }
    return id
  }

  fun getPendingShares(context: Context): List<PendingShare> = synchronized(lock) {
    val entries = readEntries(context)
    buildList {
      for (index in 0 until entries.length()) {
        val entry = entries.optJSONObject(index) ?: continue
        val id = entry.optString("id")
        if (id.isEmpty() || !entry.has("text")) {
          continue
        }
        add(
          PendingShare(
            id = id,
            text = entry.optString("text"),
            receivedAtEpochMs = entry.optLong("receivedAtEpochMs"),
            initialTitle = entry.optStringOrNull("initialTitle"),
            preselectedCollectionId = entry.optLongOrNull("preselectedCollectionId"),
            draftTitle = entry.optStringOrNull("draftTitle"),
            draftCollectionId = entry.optLongOrNull("draftCollectionId"),
          ),
        )
      }
    }
  }

  fun acknowledge(context: Context, id: String) {
    synchronized(lock) {
      val entries = readEntries(context)
      val remaining = JSONArray()
      for (index in 0 until entries.length()) {
        val entry = entries.optJSONObject(index) ?: continue
        if (entry.optString("id") != id) {
          remaining.put(entry)
        }
      }
      writeEntries(context, remaining)
    }
  }

  private fun JSONObject.optStringOrNull(key: String): String? =
    if (has(key) && !isNull(key)) optString(key) else null

  private fun JSONObject.optLongOrNull(key: String): Long? =
    if (has(key) && !isNull(key)) optLong(key) else null

  private fun getClipText(clipData: ClipData?): String? =
    clipData?.takeIf { it.itemCount > 0 }?.getItemAt(0)?.text?.toString()

  private fun readEntries(context: Context): JSONArray {
    val serialized = context.getSharedPreferences(PreferencesName, Context.MODE_PRIVATE)
      .getString(QueueKey, null)
      ?: return JSONArray()

    return try {
      JSONArray(serialized)
    } catch (_: Exception) {
      JSONArray()
    }
  }

  private fun writeEntries(context: Context, entries: JSONArray) {
    context.getSharedPreferences(PreferencesName, Context.MODE_PRIVATE)
      .edit()
      .putString(QueueKey, entries.toString())
      .commit()
  }
}
