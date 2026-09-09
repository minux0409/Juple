package com.juple.app

import android.content.Context

/**
 * Native mirror of the JS "공유 즉시 저장" setting (see quickSaveOnSharePreference.ts) - a
 * dedicated SharedPreferences file (separate from PendingShareQueue's own) so
 * ShareReceiverActivity can read it synchronously, with no guarantee the JS/bridge is running yet
 * when a share intent arrives. Defaults to true (ON), matching the JS-side default and preserving
 * the pre-existing silent-save behavior on a fresh install before any toggle has synced.
 */
object QuickSaveOnSharePreference {
  private const val PreferencesName = "juple_settings"
  private const val Key = "quickSaveOnShare"

  fun isEnabled(context: Context): Boolean =
    context.getSharedPreferences(PreferencesName, Context.MODE_PRIVATE).getBoolean(Key, true)

  fun set(context: Context, enabled: Boolean) {
    context.getSharedPreferences(PreferencesName, Context.MODE_PRIVATE)
      .edit()
      .putBoolean(Key, enabled)
      .commit()
  }
}
