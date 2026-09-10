package com.juple.app

import android.content.Context
import android.content.Intent
import androidx.core.content.pm.ShortcutInfoCompat
import androidx.core.content.pm.ShortcutManagerCompat
import androidx.core.graphics.drawable.IconCompat

/**
 * Publishes each Collection ("카테고리") as an Android Sharing Shortcuts direct-share target (see
 * res/xml/shortcuts.xml's matching <share-target>), so the system Sharesheet can offer
 * "<category name>" as its own row alongside the generic Juple target. setDynamicShortcuts always
 * REPLACES the whole set in one call, which is what keeps a renamed/deleted/unfavorited category
 * from leaving a stale shortcut behind - every sync recomputes the full desired list from the
 * current CategorySnapshotStore contents rather than diffing.
 */
object ShortcutSyncManager {
  private const val ShareTargetCategory = "com.juple.app.sharetarget.CATEGORY"
  private const val ShortcutIdPrefix = "category-"
  private const val MaxLabelLength = 25

  fun sync(context: Context, categories: List<CategorySnapshotEntry>) {
    val maxShortcuts = ShortcutManagerCompat.getMaxShortcutCountPerActivity(context)
    if (maxShortcuts <= 0) {
      ShortcutManagerCompat.removeAllDynamicShortcuts(context)
      return
    }

    // Ranking (favorite categories first, then whatever order the JS side already prioritized -
    // see categorySnapshotSync.ts) is Juple's own signal; the OS/launcher may still re-rank or
    // truncate what's actually shown in the Sharesheet.
    val ranked = categories.sortedByDescending { it.isFavorite }.take(maxShortcuts)

    val shortcuts = ranked.map { category ->
      // Only a fallback for long-pressing the app icon in the launcher - the Sharesheet's Direct
      // Share row itself resolves to ShareReceiverActivity via shortcuts.xml's <share-target>,
      // not this Intent.
      val fallbackIntent = Intent(context, MainActivity::class.java).setAction(Intent.ACTION_MAIN)

      ShortcutInfoCompat.Builder(context, shortcutId(category.id))
        .setShortLabel(category.name.take(MaxLabelLength))
        .setLongLabel(category.name.take(MaxLabelLength))
        .setIcon(IconCompat.createWithResource(context, R.mipmap.ic_launcher))
        .setCategories(setOf(ShareTargetCategory))
        .setIntent(fallbackIntent)
        .build()
    }

    ShortcutManagerCompat.setDynamicShortcuts(context, shortcuts)
  }

  fun clear(context: Context) {
    ShortcutManagerCompat.removeAllDynamicShortcuts(context)
  }

  fun shortcutId(categoryId: Long): String = "$ShortcutIdPrefix$categoryId"

  /** Reverses [shortcutId]; null if the id doesn't match this app's own scheme (e.g. a stale/foreign shortcut id). */
  fun categoryIdFromShortcutId(shortcutId: String?): Long? =
    shortcutId
      ?.takeIf { it.startsWith(ShortcutIdPrefix) }
      ?.removePrefix(ShortcutIdPrefix)
      ?.toLongOrNull()
}
