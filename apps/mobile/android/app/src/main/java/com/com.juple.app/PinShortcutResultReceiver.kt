package com.juple.app

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/**
 * The launcher's answer to "홈 화면에 바로가기 추가": delivered only when the user actually accepted the pin. That is the one
 * moment a shareable Collection becomes a Direct Share destination (see [HomeShortcutPinner]) - a cancelled dialog sends
 * nothing, so nothing is marked. If a launcher never reports acceptance, the Home icon still works and the Collection simply
 * is not a share target: the safe side of an unreliable signal. At the platform limit the new Collection is NOT added (no
 * Collection the user already chose is evicted); the Home icon stays.
 */
class PinShortcutResultReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    if (intent.action != HomeShortcutPinner.ActionPinned) {
      return
    }
    val collectionId = intent.getLongExtra(ShortcutSyncManager.ExtraCollectionId, -1L)
    val name = intent.getStringExtra(HomeShortcutPinner.ExtraName)
    if (collectionId < 0 || name.isNullOrBlank() || !intent.getBooleanExtra(HomeShortcutPinner.ExtraShareable, false)) {
      return
    }

    val existing = CollectionShortcutPreferenceStore.get(context)
    if (!HomeShortcutPinner.canJoinShareTargets(existing, collectionId, ShortcutSyncManager.maxShortcuts(context))) {
      return
    }
    val entry = PinnedCollectionEntry(
      id = collectionId,
      name = name,
      iconKey = intent.getStringExtra(HomeShortcutPinner.ExtraIconKey),
      tileColor = intent.getStringExtra(HomeShortcutPinner.ExtraTileColor),
      glyphColor = intent.getStringExtra(HomeShortcutPinner.ExtraGlyphColor),
      imageVersion = intent.getStringExtra(HomeShortcutPinner.ExtraImageVersion),
    )
    val updated = existing.filter { it.id != collectionId } + entry
    CollectionShortcutPreferenceStore.set(context, updated)
    ShortcutSyncManager.sync(context, updated)
  }
}
