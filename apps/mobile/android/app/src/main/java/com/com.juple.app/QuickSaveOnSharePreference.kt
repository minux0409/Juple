package com.juple.app

import android.content.Context

/**
 * Native mirror of the JS "공유 즉시 저장" setting (see quickSaveOnSharePreference.ts) - a
 * dedicated SharedPreferences file (separate from PendingShareQueue's own) so
 * ShareReceiverActivity can read it synchronously, with no guarantee the JS/bridge is running yet
 * when a share intent arrives. Defaults to false (OFF), matching the JS-side default: on a fresh
 * install a shared link opens the review screen until the person explicitly turns quick save on.
 */
object QuickSaveOnSharePreference {
  private const val PreferencesName = "juple_settings"
  private const val Key = "quickSaveOnShare"

  fun isEnabled(context: Context): Boolean =
    context.getSharedPreferences(PreferencesName, Context.MODE_PRIVATE).getBoolean(Key, false)

  fun set(context: Context, enabled: Boolean) {
    context.getSharedPreferences(PreferencesName, Context.MODE_PRIVATE)
      .edit()
      .putBoolean(Key, enabled)
      .commit()
  }
}
