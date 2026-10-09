package com.juple.app

import android.content.Context
import android.content.Intent
import androidx.core.content.pm.ShortcutInfoCompat
import androidx.core.content.pm.ShortcutManagerCompat

/**
 * Publishes the Collections the user explicitly pinned (see CollectionShortcutPreferenceStore) through ONE set of Android dynamic
 * shortcuts that serves both surfaces:
 * - the launcher: long-pressing Juple's icon lists them, and tapping one opens that Collection ([openCollectionIntent]);
 * - the system Sharesheet: res/xml/shortcuts.xml's matching <share-target> makes the same shortcuts Direct Share rows, so
 *   a shared YouTube/Instagram link can go straight to a Collection (ShareReceiverActivity resolves EXTRA_SHORTCUT_ID).
 * setDynamicShortcuts always REPLACES the whole set in one call, which is what keeps a renamed / removed / locked
 * Collection from leaving a stale shortcut behind - every sync recomputes the full list from the pinned store.
 *
 * The shortcuts are long-lived (the supported Sharing Shortcuts pattern, so the Sharesheet can keep ranking and showing
 * them). That has one consequence handled here: the system may keep a long-lived shortcut as a CACHED one after it
 * leaves the dynamic set, which would leave its name in the Sharesheet. So whatever is no longer wanted - unpinned,
 * locked, deleted, left, signed out - is removed with removeLongLivedShortcuts (dynamic AND cached), never just dropped
 * from the dynamic list. Each shortcut id is "category-<collectionId>": stable for a Collection, never reused for another.
 * Launcher shortcuts and sharing shortcuts are the same objects, so they share one platform limit ([maxShortcuts]).
 */
object ShortcutSyncManager {
  /** Must equal res/xml/shortcuts.xml's <share-target> <category> (checked by ShortcutSyncManagerTest and androidShareTarget.test.ts). */
  const val ShareTargetCategory = "com.juple.app.sharetarget.CATEGORY"
  private const val ShortcutIdPrefix = "category-"
  const val MaxLabelLength = 25

  /** MainActivity's launcher-shortcut action; the Collection id travels in [ExtraCollectionId]. */
  const val ActionOpenCollection = "com.juple.app.action.OPEN_COLLECTION"
  const val ExtraCollectionId = "com.juple.app.extra.COLLECTION_ID"

  /** The platform's per-activity limit; JS refuses to pin past it (and shows the limit), this only guards the publish. */
  fun maxShortcuts(context: Context): Int = ShortcutManagerCompat.getMaxShortcutCountPerActivity(context)

  fun sync(context: Context, pinned: List<PinnedCollectionEntry>) {
    val max = maxShortcuts(context)
    val wanted = if (max > 0) pinned.take(max) else emptyList()

    // Unpinned / ineligible Collections go from dynamic AND cached state first, so no Sharesheet row outlives its eligibility.
    val stale = staleShortcutIds(ownedShortcutIds(context), wanted.map { shortcutId(it.id) })
    if (stale.isNotEmpty()) {
      ShortcutManagerCompat.removeLongLivedShortcuts(context, stale)
    }
    if (wanted.isEmpty()) {
      ShortcutManagerCompat.removeAllDynamicShortcuts(context)
      return
    }

    val shortcuts = wanted.mapIndexed { index, entry ->
      ShortcutInfoCompat.Builder(context, shortcutId(entry.id))
        .setShortLabel(entry.name.take(MaxLabelLength))
        .setLongLabel(entry.name.take(MaxLabelLength))
        // The same picture the Home-screen icon of this Collection has (photo > its configured icon > initial).
        .setIcon(CollectionShortcutIcon.create(context, iconSpecOf(entry, CollectionIconImages.cached(context, entry.id, entry.imageVersion))))
        .setCategories(setOf(ShareTargetCategory))
        .setLongLived(true)
        // The supported ranking signal (lower = more important): the order the user pinned them in.
        .setRank(index)
        // The launcher tap. A Direct Share row does NOT use this - the Sharesheet resolves to ShareReceiverActivity
        // through shortcuts.xml's <share-target>.
        .setIntent(openCollectionIntent(context, entry.id))
        .build()
    }

    ShortcutManagerCompat.setDynamicShortcuts(context, shortcuts)
  }

  /** Removes every Collection shortcut this app published, cached copies included (sign-out / account change). */
  /** The icon recipe of a stored Collection entry. */
  fun iconSpecOf(entry: PinnedCollectionEntry, image: android.graphics.Bitmap?) =
    CollectionIconSpec(entry.name, entry.iconKey, entry.tileColor, entry.glyphColor, image)

  fun clear(context: Context) {
    CollectionIconImages.clear(context)
    val owned = ownedShortcutIds(context)
    if (owned.isNotEmpty()) {
      ShortcutManagerCompat.removeLongLivedShortcuts(context, owned.toList())
    }
    ShortcutManagerCompat.removeAllDynamicShortcuts(context)
  }

  /** Drops what the earlier "publish every Collection" build left behind, once (see CollectionShortcutPreferenceStore.purgeLegacy). */
  fun migrateLegacy(context: Context) {
    if (CollectionShortcutPreferenceStore.purgeLegacy(context)) {
      clear(context)
    }
  }

  /** Ids of this app's Collection shortcuts the system currently holds, dynamic or cached. */
  private fun ownedShortcutIds(context: Context): List<String> =
    ShortcutManagerCompat
      .getShortcuts(context, ShortcutManagerCompat.FLAG_MATCH_DYNAMIC or ShortcutManagerCompat.FLAG_MATCH_CACHED)
      .map { it.id }
      .filter { categoryIdFromShortcutId(it) != null }

  /** What must be removed: held by the system but not wanted any more. Pure, so it is unit-tested. */
  fun staleShortcutIds(held: Collection<String>, wanted: Collection<String>): List<String> =
    held.filter { it !in wanted }.distinct()

  fun openCollectionIntent(context: Context, collectionId: Long): Intent =
    Intent(context, MainActivity::class.java)
      .setAction(ActionOpenCollection)
      .putExtra(ExtraCollectionId, collectionId)

  fun shortcutId(categoryId: Long): String = "$ShortcutIdPrefix$categoryId"

  /** Reverses [shortcutId]; null if the id doesn't match this app's own scheme (e.g. a stale/foreign shortcut id). */
  fun categoryIdFromShortcutId(shortcutId: String?): Long? =
    shortcutId
      ?.takeIf { it.startsWith(ShortcutIdPrefix) }
      ?.removePrefix(ShortcutIdPrefix)
      ?.toLongOrNull()
}
