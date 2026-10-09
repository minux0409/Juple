package com.juple.app

import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import androidx.core.content.pm.ShortcutInfoCompat
import androidx.core.content.pm.ShortcutManagerCompat

/**
 * "홈 화면에 바로가기 추가": asks the launcher, through Android's own system dialog, to put a real 1x1 icon of a Collection on
 * the Home screen (ShortcutManagerCompat.requestPinShortcut - there is no custom confirmation of ours in front of it).
 *
 * The Home icon and the Direct Share row are two different Android mechanisms fed by ONE logical identity - the shortcut id
 * "category-<collectionId>" ([ShortcutSyncManager.shortcutId]):
 * - Home icon: a pinned shortcut. Tapping it opens Juple at that Collection ([ShortcutSyncManager.openCollectionIntent]),
 *   which is only a request - the app re-reads the Collection and enforces its lock before showing anything.
 * - Direct Share row: only for a [shareable] Collection (writable, not locked), and ONLY after the launcher reports that the
 *   user really accepted the pin ([PinShortcutResultReceiver]) - tapping the entry in Juple's menu never changes the stored
 *   state, so a cancelled dialog leaves nothing behind. A locked Collection can still get its Home icon (opening it still
 *   asks for its password) but is never a share target.
 *
 * Android cannot remove a Home icon the user created; nothing here pretends it can.
 */
object HomeShortcutPinner {
  const val ActionPinned = "com.juple.app.action.HOME_SHORTCUT_PINNED"
  const val ExtraName = "com.juple.app.extra.COLLECTION_NAME"
  const val ExtraShareable = "com.juple.app.extra.SHAREABLE"
  const val ExtraIconKey = "com.juple.app.extra.ICON_KEY"
  const val ExtraTileColor = "com.juple.app.extra.TILE_COLOR"
  const val ExtraGlyphColor = "com.juple.app.extra.GLYPH_COLOR"
  const val ExtraImageVersion = "com.juple.app.extra.IMAGE_VERSION"

  const val Requested = "requested"
  const val Unsupported = "unsupported"

  fun isSupported(context: Context): Boolean = ShortcutManagerCompat.isRequestPinShortcutSupported(context)

  /**
   * Blocking when the Collection has a photo that is not cached yet (a short, capped fetch) - call off the UI thread. The photo
   * never decides whether the shortcut can be made: if it cannot be prepared the configured icon is drawn instead.
   */
  fun request(
    context: Context,
    collectionId: Long,
    name: String,
    iconKey: String?,
    tileHex: String?,
    glyphHex: String?,
    imageUrl: String?,
    imageVersion: String?,
    shareable: Boolean,
  ): String {
    if (!isSupported(context)) {
      return Unsupported
    }
    val image = CollectionIconImages.prepare(context, collectionId, imageVersion, imageUrl)

    val builder = ShortcutInfoCompat.Builder(context, ShortcutSyncManager.shortcutId(collectionId))
      .setShortLabel(name.take(ShortcutSyncManager.MaxLabelLength))
      .setLongLabel(name.take(ShortcutSyncManager.MaxLabelLength))
      .setIcon(CollectionShortcutIcon.create(context, CollectionIconSpec(name, iconKey, tileHex, glyphHex, image)))
      .setIntent(ShortcutSyncManager.openCollectionIntent(context, collectionId))
    if (shareable) {
      builder.setCategories(setOf(ShortcutSyncManager.ShareTargetCategory)).setLongLived(true)
    }

    val callback = PendingIntent.getBroadcast(
      context,
      collectionId.hashCode(),
      Intent(context, PinShortcutResultReceiver::class.java)
        .setAction(ActionPinned)
        .putExtra(ShortcutSyncManager.ExtraCollectionId, collectionId)
        .putExtra(ExtraName, name)
        .putExtra(ExtraShareable, shareable)
        // What the share row's icon is drawn from later (no URL, no secret) - the same recipe as this icon.
        .putExtra(ExtraIconKey, iconKey)
        .putExtra(ExtraTileColor, tileHex)
        .putExtra(ExtraGlyphColor, glyphHex)
        .putExtra(ExtraImageVersion, if (image != null) imageVersion else null),
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )
    return if (ShortcutManagerCompat.requestPinShortcut(context, builder.build(), callback.intentSender)) Requested else Unsupported
  }

  /** Pure: may a confirmed pin join the share targets without evicting one the user already has? */
  fun canJoinShareTargets(existing: List<PinnedCollectionEntry>, collectionId: Long, max: Int): Boolean =
    existing.any { it.id == collectionId } || existing.size < max
}
