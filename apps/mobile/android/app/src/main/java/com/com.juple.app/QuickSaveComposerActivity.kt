package com.juple.app

import android.os.Bundle
import com.facebook.react.ReactActivity
import com.facebook.react.ReactActivityDelegate
import com.facebook.react.defaults.DefaultReactActivityDelegate

/**
 * Small dialog/bottom-sheet-styled Activity shown over the sharing app (see
 * res/values/styles.xml's QuickSaveComposerTheme) - deliberately not MainActivity, so opening it
 * doesn't boot the app's full navigation stack. Hosts the "QuickSaveComposer" JS component (a
 * separate AppRegistry root from "JupleMobile" - see index.js) via the same shared ReactHost
 * MainActivity uses (see MainApplication), so an already-running app process gets an
 * already-warm JS instance.
 */
class QuickSaveComposerActivity : ReactActivity() {
  override fun getMainComponentName(): String = "QuickSaveComposer"

  override fun createReactActivityDelegate(): ReactActivityDelegate =
    object : DefaultReactActivityDelegate(this, mainComponentName) {
      override fun getLaunchOptions(): Bundle =
        Bundle().apply {
          putString("pendingShareId", intent?.getStringExtra(ExtraPendingShareId))
        }
    }

  companion object {
    const val ExtraPendingShareId = "com.juple.app.EXTRA_PENDING_SHARE_ID"
  }
}
