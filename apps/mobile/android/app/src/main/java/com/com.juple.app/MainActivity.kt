package com.juple.app

import android.content.Intent
import android.os.Bundle
import com.facebook.react.ReactActivity
import com.facebook.react.ReactActivityDelegate
import com.facebook.react.defaults.DefaultNewArchitectureEntryPoint.fabricEnabled
import com.facebook.react.defaults.DefaultReactActivityDelegate
import com.swmansion.rnscreens.fragment.restoration.RNScreensFragmentFactory

class MainActivity : ReactActivity() {

  /**
   * Returns the name of the main component registered from JavaScript. This is used to schedule
   * rendering of the component.
   */
  override fun getMainComponentName(): String = "JupleMobile"

  // react-native-screens override: Android does not persist View state consistently across
  // Activity restarts, which can crash react-native-screens' Fragment-based navigation.
  override fun onCreate(savedInstanceState: Bundle?) {
    supportFragmentManager.fragmentFactory = RNScreensFragmentFactory()
    super.onCreate(savedInstanceState)
    // Drops what the earlier "publish every Collection" build left in the launcher, once (see ShortcutSyncManager).
    ShortcutSyncManager.migrateLegacy(this)
    // A launcher-shortcut tap that started the app. Not on a restore (savedInstanceState != null): the same Intent is
    // redelivered then and must not open the Collection a second time.
    if (savedInstanceState == null) {
      ShortcutLaunchStore.captureOpenCollection(this, intent)
    }
  }

  /** A launcher-shortcut tap while the app already runs (singleTask): left for JS to open once it is in front. */
  override fun onNewIntent(intent: Intent) {
    ShortcutLaunchStore.captureOpenCollection(this, intent)
    super.onNewIntent(intent)
  }

  /**
   * Returns the instance of the [ReactActivityDelegate]. We use [DefaultReactActivityDelegate]
   * which allows you to enable New Architecture with a single boolean flags [fabricEnabled]
   */
  override fun createReactActivityDelegate(): ReactActivityDelegate =
      DefaultReactActivityDelegate(this, mainComponentName, fabricEnabled)
}
